/**
 * Pinned Maestro schema — validation cases (Phase 4, Task 0 + C2).
 *
 * The pinned set is exactly the nine C2 commands. These tests assert
 * the whitelist (an unknown command fails) and the YAML round trip
 * (config + `---` + commands). They use hand-built command objects
 * only — no sample flow is shipped (Phase 4 constraint).
 */
import { describe, expect, it } from 'vitest';
import {
  MAESTRO_COMMANDS,
  parseMaestroFlow,
  parseMaestroYaml,
  renderMaestroYaml,
} from './maestro-schema.js';

describe('pinned Maestro command set', () => {
  it('covers exactly the nine C2 commands', () => {
    expect([...MAESTRO_COMMANDS].sort()).toEqual(
      [
        'assertNotVisible',
        'assertVisible',
        'clearState',
        'inputText',
        'launchApp',
        'longPressOn',
        'pressKey',
        'swipe',
        'tapOn',
      ].sort(),
    );
  });

  it('accepts every pinned command shape', () => {
    const flow = parseMaestroFlow(
      { appId: 'com.shop.app', name: 'probe', onFlowComplete: [{ clearState: null }] },
      [
        { launchApp: { clearState: true } },
        { tapOn: { id: 'com.shop.app:id/pay' } },
        { inputText: '${TEST_LOGIN_PASSWORD}' },
        { longPressOn: { id: 'com.shop.app:id/item' } },
        { swipe: { direction: 'UP', duration: 400 } },
        { pressKey: 'BACK' },
        { assertVisible: { id: 'com.shop.app:id/pay' } },
        { assertNotVisible: 'Loading…' },
        { clearState: null },
      ],
    );
    expect(flow.commands).toHaveLength(9);
  });

  it('rejects a command outside the pinned set', () => {
    expect(() => parseMaestroFlow({ appId: 'com.shop.app' }, [{ takeScreenshot: 'x.png' }])).toThrow(
      /Invalid Maestro flow commands/,
    );
  });

  it('rejects the plan draft name longPress (pinned name is longPressOn)', () => {
    expect(() => parseMaestroFlow({ appId: 'com.shop.app' }, [{ longPress: { id: 'x' } }])).toThrow(
      /Invalid Maestro flow commands/,
    );
  });

  it('rejects a flow without an appId', () => {
    expect(() => parseMaestroFlow({ name: 'probe' }, [])).toThrow(/Invalid Maestro flow config/);
  });
});

describe('Maestro YAML text validation', () => {
  it('parses a rendered two-document flow and re-validates it', () => {
    const flow = parseMaestroFlow(
      { appId: 'com.shop.app', name: 'probe' },
      [{ launchApp: { clearState: true } }, { assertVisible: { id: 'com.shop.app:id/pay' } }],
    );
    const text = renderMaestroYaml(flow, {
      sourceHash: 'sha256:ab12',
      generatedAt: '2026-11-13T00:00:00.000Z',
      schemaVersion: 2,
    });
    expect(text).toContain('# sourceJsonSha256: sha256:ab12');
    expect(text).toContain('# schemaVersion: 2');
    expect(text).toContain('one-way/lossy');
    const reparsed = parseMaestroYaml(text);
    expect(reparsed.config.appId).toBe('com.shop.app');
    expect(reparsed.commands).toHaveLength(2);
  });

  it('rejects YAML with a single document', () => {
    expect(() => parseMaestroYaml('appId: com.shop.app\n')).toThrow(/exactly 2 documents/);
  });

  it('rejects unparseable YAML', () => {
    expect(() => parseMaestroYaml('a: [1,\n b: }')).toThrow(/does not parse/);
  });
});
