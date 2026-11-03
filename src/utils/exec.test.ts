import { describe, expect, it } from 'vitest';
import { execCommand, execCommandBinary } from './exec.js';

describe('execCommand cancellation', () => {
  it('captures stdout and stderr without corrupting binary output', async () => {
    const textResult = await execCommand(process.execPath, ['-e', "process.stdout.write('hello'); process.stderr.write('warning')"]);
    expect(textResult.stdout).toBe('hello');
    expect(textResult.stderr).toBe('warning');
    expect(textResult.exitCode).toBe(0);

    const binaryResult = await execCommandBinary(process.execPath, ['-e', "process.stdout.write(Buffer.from([0, 255, 1]))"]);
    expect([...binaryResult.stdout]).toEqual([0, 255, 1]);
  });

  it('rejects an already-aborted command without spawning it', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(execCommand(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'COMMAND_FAILED', details: { cancelled: true } });
  });

  it('terminates a running child when its signal is aborted', async () => {
    const controller = new AbortController();
    const running = execCommand(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 10000)'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(running).rejects.toMatchObject({ code: 'COMMAND_FAILED', details: { cancelled: true } });
  });
});
