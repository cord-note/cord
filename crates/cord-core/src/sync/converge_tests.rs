//! Random edits on several devices, delivered in any order, end identical.

use serde_json::json;

use crate::doc::yjs::append_blocks;
use crate::layout::DataLayout;
use crate::model::{NewNote, NewTag, NewVault, NoteChanges};
use crate::services::{notes, tags, vaults};
use crate::session::Session;
use crate::sync::apply::apply_batch;
use crate::sync::link::{attach_server_vault, link_vault};
use crate::sync::outbox::{confirm, next_batch};
use crate::sync::wire::WireChange;

/// Small deterministic generator, so a failure replays.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

struct Device {
    _dir: tempfile::TempDir,
    s: Session,
}

fn device(name: &str) -> Device {
    let dir = tempfile::tempdir().unwrap();
    let (s, _) = Session::open(&DataLayout::new(dir.path()), name, "u1", None).unwrap();
    Device { _dir: dir, s }
}

/// Send everything owed to the fake server; it stores each id once.
fn push(d: &mut Device, log: &mut Vec<WireChange>) {
    loop {
        let batch = next_batch(d.s.conn(), "c1").unwrap();
        if batch.changes.is_empty() {
            return;
        }
        let ids: Vec<String> = batch.changes.iter().map(|c| c.id.clone()).collect();
        for c in &batch.changes {
            if !log.iter().any(|l| l.id == c.id) {
                let mut c = c.clone();
                c.seq = Some(log.len() as i64 + 1);
                log.push(c);
            }
        }
        confirm(d.s.conn(), "c1", &batch, &ids).unwrap();
    }
}

/// Deliver the log shuffled, with repeats, in random pieces.
fn deliver_badly(d: &mut Device, vault: &str, log: &[WireChange], rng: &mut Rng) {
    let mut items: Vec<WireChange> = log.to_vec();
    for _ in 0..log.len() / 3 {
        items.push(log[rng.below(log.len())].clone());
    }
    for i in (1..items.len()).rev() {
        items.swap(i, rng.below(i + 1));
    }
    while !items.is_empty() {
        let take = 1 + rng.below(items.len().min(7));
        let piece: Vec<WireChange> = items.drain(..take).collect();
        apply_batch(&mut d.s, "c1", vault, &piece).unwrap();
    }
}

fn live_notes(d: &Device, vault: &str) -> Vec<String> {
    let mut st = d.s.conn().prepare("SELECT id FROM notes WHERE vault_id = ?1 AND deleted_at IS NULL ORDER BY id").unwrap();
    st.query_map([vault], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
}

fn edit(d: &mut Device, vault: &str, tag: &str, rng: &mut Rng, step: usize) {
    let live = live_notes(d, vault);
    let pick = |rng: &mut Rng| live.get(rng.below(live.len().max(1))).cloned();
    match rng.below(5) {
        0 => {
            notes::create(&mut d.s, NewNote { vault_id: vault.into(), title: Some(format!("n{step}")), ..Default::default() }).unwrap();
        }
        1 => {
            if let Some(id) = pick(rng) {
                let _ = notes::update(&mut d.s, &id, NoteChanges { title: Some(format!("t{step}")), ..Default::default() });
            }
        }
        2 => {
            if let Some(id) = pick(rng) {
                let state = notes::body_state(&d.s, &id).unwrap().unwrap_or_default();
                let block = json!({ "type": "paragraph", "content": [{ "type": "text", "text": format!("p{step}") }] });
                let update = append_blocks(&state, &[block]).unwrap();
                notes::apply_body_update(&mut d.s, &id, &update).unwrap();
            }
        }
        3 => {
            if let Some(id) = pick(rng) {
                let _ = tags::attach(&mut d.s, &id, tag);
            }
        }
        _ => {
            if let Some(id) = pick(rng) {
                let _ = notes::delete(&mut d.s, &id);
            }
        }
    }
}

/// Everything that must match across devices.
fn snapshot(d: &Device) -> Vec<String> {
    let q = |sql: &str| -> Vec<String> {
        let mut st = d.s.conn().prepare(sql).unwrap();
        st.query_map([], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    let mut out = q("SELECT id || '|' || title || '|' || is_pinned || '|' || ifnull(deleted_at, '-') FROM notes ORDER BY id");
    out.extend(q("SELECT note_id || '|' || body_json FROM idx.note_docs ORDER BY note_id"));
    out.extend(q("SELECT note_id || '|' || tag_id || '|' || ifnull(removed_at, '-') FROM note_tags ORDER BY 1"));
    out
}

#[test]
fn devices_converge_whatever_the_delivery_order() {
    for seed in [7_u64, 42, 2026] {
        let mut rng = Rng(seed);
        let mut log: Vec<WireChange> = Vec::new();
        let mut a = device("dev-a");
        let v = vaults::create(&mut a.s, NewVault { name: "Shared".into(), ..Default::default() }).unwrap();
        let tag = tags::create(&mut a.s, NewTag { vault_id: v.id.clone(), name: "idea".into(), color: None }).unwrap();
        link_vault(&mut a.s, "c1", &v.id, "owner").unwrap();
        push(&mut a, &mut log);

        let mut devices = vec![a, device("dev-b"), device("dev-c")];
        for d in &mut devices[1..] {
            attach_server_vault(d.s.conn(), "c1", &v.id, "owner", 1).unwrap();
            apply_batch(&mut d.s, "c1", &v.id, &log).unwrap();
        }

        for round in 0..6 {
            for (n, d) in devices.iter_mut().enumerate() {
                for k in 0..4 {
                    edit(d, &v.id, &tag.id, &mut rng, round * 100 + n * 10 + k);
                }
            }
            for d in &mut devices {
                push(d, &mut log);
            }
            for d in &mut devices {
                deliver_badly(d, &v.id, &log, &mut rng);
            }
        }
        for d in &mut devices {
            push(d, &mut log);
        }
        for d in &mut devices {
            apply_batch(&mut d.s, "c1", &v.id, &log).unwrap();
        }

        let first = snapshot(&devices[0]);
        assert!(first.len() > 5, "seed {seed}: too little happened to prove anything");
        for d in &devices[1..] {
            assert_eq!(snapshot(d), first, "seed {seed}: devices differ");
        }
        let parked: i64 = devices[1].s.conn().query_row("SELECT count(*) FROM sync_parked", [], |r| r.get(0)).unwrap();
        assert_eq!(parked, 0, "seed {seed}: changes left parked");
    }
}
