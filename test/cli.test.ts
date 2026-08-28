import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

const runCli = (args: string[]) => run(args);

describe('cli', () => {
  it('exits 1 when an error-severity finding is present', async () => {
    const { code } = await runCli(['test/fixtures/set-include-other-fields.bad.json']);
    expect(code).toBe(1);
  });

  it('exits 0 on a clean workflow', async () => {
    const { code } = await runCli(['test/fixtures/set-include-other-fields.good.json']);
    expect(code).toBe(0);
  });

  it('exits 2 on a path that does not exist', async () => {
    const { code } = await runCli(['./does-not-exist.json']);
    expect(code).toBe(2);
  });

  it('exits 2 when no input paths are given', async () => {
    const { code } = await runCli([]);
    expect(code).toBe(2);
  });

  it('emits parseable JSON under --json', async () => {
    const { stdout } = await runCli(['test/fixtures/set-include-other-fields.bad.json', '--json']);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('restricts the run to the rules named by --rule', async () => {
    const kept = await runCli([
      'test/fixtures/set-include-other-fields.bad.json',
      '--rule',
      'set-include-other-fields',
    ]);
    expect(kept.code).toBe(1);

    const filtered = await runCli([
      'test/fixtures/set-include-other-fields.bad.json',
      '--rule',
      'no-such-rule',
    ]);
    expect(filtered.code).toBe(0);
  });

  it('prints usage under --help and exits 0', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/n8n-doctor/);
  });
});
