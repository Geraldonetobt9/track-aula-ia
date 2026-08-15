import { mapWithConcurrency } from '../vturb-api.client';

describe('mapWithConcurrency', () => {
  it('keeps results aligned with the input order', async () => {
    const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      // Reverse the delays so completion order differs from input order.
      await new Promise((resolve) => setTimeout(resolve, (6 - n) * 2));
      return n * 10;
    });

    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the limit — this is what protects the VTurb quota', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list without hanging', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
  });

  it('does not spawn more runners than there are items', async () => {
    let started = 0;

    await mapWithConcurrency([1, 2], 10, async (n) => {
      started += 1;
      return n;
    });

    expect(started).toBe(2);
  });
});
