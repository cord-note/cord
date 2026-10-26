import { describe, it, expect } from 'bun:test';
import { parseRepoUrl, downloadArchive } from '../repoSource';

const archive = (link: string) => parseRepoUrl(link).archiveUrl;

describe('parseRepoUrl', () => {
  it('maps GitHub repo, branch and folder links', () => {
    expect(archive('https://github.com/acme/themes')).toBe('https://github.com/acme/themes/archive/HEAD.zip');
    expect(archive('https://github.com/acme/themes.git')).toBe('https://github.com/acme/themes/archive/HEAD.zip');
    const r = parseRepoUrl('https://github.com/acme/themes/tree/v2/packs/dark');
    expect(r.archiveUrl).toBe('https://github.com/acme/themes/archive/v2.zip');
    expect(r.subPath).toBe('packs/dark');
  });

  it('maps GitLab projects, including groups and refs', () => {
    expect(archive('https://gitlab.com/grp/sub/themes')).toBe(
      'https://gitlab.com/api/v4/projects/grp%2Fsub%2Fthemes/repository/archive.zip');
    const r = parseRepoUrl('https://gitlab.com/grp/themes/-/tree/main/dusk');
    expect(r.archiveUrl).toBe('https://gitlab.com/api/v4/projects/grp%2Fthemes/repository/archive.zip?sha=main');
    expect(r.subPath).toBe('dusk');
  });

  it('maps Codeberg branch links and asks the API for the default branch', async () => {
    expect(archive('https://codeberg.org/ola/themes/src/branch/dev/x')).toBe('https://codeberg.org/ola/themes/archive/dev.zip');
    const lazy = archive('https://codeberg.org/ola/themes');
    expect(typeof lazy).toBe('function');
    const fake = async () => new Response(JSON.stringify({ default_branch: 'trunk' }));
    expect(await (lazy as (f: typeof fake) => Promise<string>)(fake)).toBe('https://codeberg.org/ola/themes/archive/trunk.zip');
  });

  it('accepts a direct https .zip link and refuses everything else', () => {
    expect(archive('https://example.com/pack.zip')).toBe('https://example.com/pack.zip');
    expect(() => parseRepoUrl('http://github.com/acme/themes')).toThrow(/https/);
    expect(() => parseRepoUrl('https://example.com/page')).toThrow();
    expect(() => parseRepoUrl('not a url')).toThrow();
  });
});

describe('downloadArchive', () => {
  const bytes = (n: number) => new Response(new Uint8Array(n));

  it('returns the body', async () => {
    expect((await downloadArchive('https://x/a.zip', async () => bytes(10), 100)).length).toBe(10);
  });

  it('stops at the size limit', async () => {
    await expect(downloadArchive('https://x/a.zip', async () => bytes(200), 100)).rejects.toThrow(/too large/);
  });

  it('explains a 404', async () => {
    await expect(downloadArchive('https://x/a.zip', async () => new Response('', { status: 404 }), 100))
      .rejects.toThrow(/public/);
  });
});
