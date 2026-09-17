/**
 * Teto por hora (Fase 3, canal Instagram) — aditivo ao motor de pacing.
 * Prova duas coisas: (1) canal SEM `warmupHourlyCaps` (WhatsApp/UAZAPI/Zernio)
 * não muda de comportamento nenhum; (2) canal COM o knob (Instagram) veta ao
 * atingir o teto, mesmo com o cap diário/warmup ainda folgado.
 */
import { describe, expect, it } from 'vitest';

import { decidePacing, type PacingState } from '@/lib/agent-engine/pacing/engine';
import { INSTAGRAM_PACING_DEFAULTS, PACING_DEFAULTS } from '@/lib/agent-engine/pacing/defaults';

const COMERCIAL = new Date('2026-09-17T14:00:00-03:00'); // quarta, dentro da janela 7-22

function estadoBase(overrides: Partial<PacingState> = {}): PacingState {
  return { lastSentAt: null, sentToday: 0, numberActivatedAt: null, ...overrides };
}

describe('teto por hora — canal sem o knob não muda', () => {
  it('PACING_DEFAULTS (WhatsApp/UAZAPI) ignora sentLastHour por completo', () => {
    const r = decidePacing({
      now: COMERCIAL,
      knobs: PACING_DEFAULTS,
      state: estadoBase({ sentLastHour: 99_999 }),
      crmDailyLimit: null,
      rng: () => 0,
    });
    expect(r.allow).toBe(true);
  });
});

describe('teto por hora — canal com o knob (Instagram)', () => {
  it('abaixo do teto, passa', () => {
    const r = decidePacing({
      now: COMERCIAL,
      knobs: INSTAGRAM_PACING_DEFAULTS,
      state: estadoBase({ sentLastHour: 199 }),
      crmDailyLimit: null,
      rng: () => 0,
    });
    expect(r.allow).toBe(true);
  });

  it('no teto exato (200), veta com code hourly_cap', () => {
    const r = decidePacing({
      now: COMERCIAL,
      knobs: INSTAGRAM_PACING_DEFAULTS,
      state: estadoBase({ sentLastHour: 200 }),
      crmDailyLimit: null,
      rng: () => 0,
    });
    expect(r.allow).toBe(false);
    if (r.allow) throw new Error('inalcançável');
    expect(r.code).toBe('hourly_cap');
  });

  it('cap diário/warmup ainda folgado não mascara o veto por hora', () => {
    const r = decidePacing({
      now: COMERCIAL,
      knobs: INSTAGRAM_PACING_DEFAULTS,
      state: estadoBase({ sentToday: 1, sentLastHour: 250 }),
      crmDailyLimit: 10_000,
      rng: () => 0,
    });
    expect(r.allow).toBe(false);
    if (r.allow) throw new Error('inalcançável');
    expect(r.code).toBe('hourly_cap');
  });

  it('sentLastHour ausente (undefined) é tratado como 0 — nunca veta por acidente', () => {
    const r = decidePacing({
      now: COMERCIAL,
      knobs: INSTAGRAM_PACING_DEFAULTS,
      state: estadoBase(),
      crmDailyLimit: null,
      rng: () => 0,
    });
    expect(r.allow).toBe(true);
  });
});
