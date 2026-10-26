// Theme packs from a git host, fetched as the zip archive the host serves for
// any public repo, so no git client is needed. GitHub, GitLab and Codeberg are
// understood; any other https link must point straight at a .zip.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ArchiveRequest {
  /** Where the zip comes from. Codeberg without a branch is resolved first. */
  archiveUrl: string | ((fetcher: FetchLike) => Promise<string>);
  /** Folder inside the repo to search, from a /tree/<ref>/<path> link. */
  subPath: string | null;
}

const UNSUPPORTED = 'Use a GitHub, GitLab or Codeberg repo link, or an https link to a .zip';

export function parseRepoUrl(input: string): ArchiveRequest {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error(UNSUPPORTED); }
  if (url.protocol !== 'https:') throw new Error('Only https links are supported');

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const clean = (name: string): string => name.replace(/\.git$/, '');
  const sub = (rest: string[]): string | null => (rest.length ? rest.join('/') : null);
  const seg = (s: string): string => encodeURIComponent(s);

  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo, kind, ref, ...rest] = parts as [string, string, ...string[]];
    const hasRef = kind === 'tree' && ref;
    return {
      archiveUrl: `https://github.com/${seg(owner)}/${seg(clean(repo))}/archive/${hasRef ? seg(ref) : 'HEAD'}.zip`,
      subPath: hasRef ? sub(rest) : null,
    };
  }

  if (host === 'gitlab.com' && parts.length >= 2) {
    const dash = parts.indexOf('-');
    const project = (dash === -1 ? parts : parts.slice(0, dash)).map(clean).join('/');
    const [kind, ref, ...rest] = dash === -1 ? [] : parts.slice(dash + 1);
    const hasRef = kind === 'tree' && ref;
    return {
      archiveUrl: `https://gitlab.com/api/v4/projects/${seg(project)}/repository/archive.zip${hasRef ? `?sha=${seg(ref)}` : ''}`,
      subPath: hasRef ? sub(rest) : null,
    };
  }

  if (host === 'codeberg.org' && parts.length >= 2) {
    const [owner, repo, kind, refKind, ref, ...rest] = parts as [string, string, ...string[]];
    const name = clean(repo);
    const base = `https://codeberg.org/${seg(owner)}/${seg(name)}`;
    if (kind === 'src' && refKind && ref) {
      return { archiveUrl: `${base}/archive/${seg(ref)}.zip`, subPath: sub(rest) };
    }
    // Codeberg needs a branch name for archives; ask its API for the default one.
    return {
      archiveUrl: async (fetcher) => {
        const res = await fetcher(`https://codeberg.org/api/v1/repos/${seg(owner)}/${seg(name)}`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Codeberg answered ${res.status} for ${owner}/${name}`);
        const { default_branch: branch } = (await res.json()) as { default_branch?: string };
        if (!branch) throw new Error('Could not find the default branch');
        return `${base}/archive/${seg(branch)}.zip`;
      },
      subPath: null,
    };
  }

  if (url.pathname.toLowerCase().endsWith('.zip')) return { archiveUrl: url.toString(), subPath: null };
  throw new Error(UNSUPPORTED);
}

/** Downloads `url` (https only, redirects included), refusing anything over `maxBytes`. */
export async function downloadArchive(url: string, fetcher: FetchLike, maxBytes: number, timeoutMs = 60_000): Promise<Uint8Array> {
  const res = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (res.url && !res.url.startsWith('https:')) throw new Error('The download was redirected away from https');
  if (res.status === 404) throw new Error('Not found. Is the repo public, and the branch name right?');
  if (!res.ok) throw new Error(`The server answered ${res.status}`);

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error('The download is too large');
  if (!res.body) return new Uint8Array(await res.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('The download is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
