//! cord-server serve | invite | member add

use std::path::PathBuf;

const USAGE: &str = "usage:
  cord-server serve [--data DIR] [--addr HOST:PORT]
  cord-server invite [--data DIR] [--days N]
  cord-server member add <vault-id> <username> <owner|editor> [--data DIR]";

/// The value after `--name`, if given.
fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

/// Arguments that are not flags or flag values.
fn plain(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip = false;
    for a in args {
        if skip {
            skip = false;
        } else if a.starts_with("--") {
            skip = true;
        } else {
            out.push(a.clone());
        }
    }
    out
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = PathBuf::from(flag(&args, "--data").unwrap_or_else(|| "data".into()));
    let words = plain(&args);
    let result = match words.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["serve"] => serve(&data, flag(&args, "--addr").unwrap_or_else(|| "127.0.0.1:8787".into())).await,
        ["invite"] => {
            let days = flag(&args, "--days").and_then(|d| d.parse().ok()).unwrap_or(7);
            cord_server::admin::invite(&data, days).map(|code| println!("{code}")).map_err(|e| e.to_string())
        }
        ["member", "add", vault, user, role] => cord_server::admin::add_member(&data, vault, user, role)
            .map(|()| println!("{user} is now {role} of {vault}")),
        _ => Err(USAGE.to_owned()),
    };
    if let Err(message) = result {
        eprintln!("{message}");
        std::process::exit(1);
    }
}

async fn serve(data: &std::path::Path, addr: String) -> Result<(), String> {
    let server = cord_server::Server::open(data, 12).map_err(|e| e.to_string())?;
    let listener = tokio::net::TcpListener::bind(&addr).await.map_err(|e| format!("cannot listen on {addr}: {e}"))?;
    eprintln!("[server] listening on {addr}, data in {}", data.display());
    cord_server::serve(listener, server).await.map_err(|e| e.to_string())
}
