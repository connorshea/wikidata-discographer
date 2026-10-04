import { describe, expect, it } from "vite-plus/test";
import { createEditPacer } from "./edit-pace.ts";

/** A pacer on a fake clock that records each wait. */
function fakePacer() {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const pacer = createEditPacer({
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    createGapMs: 5000,
    editGapMs: 2000,
    serverGapMs: 1000,
  });
  return { pacer, sleeps, tick: (ms: number) => (clock += ms) };
}

describe("createEditPacer", () => {
  it("lets a user's first write go at once, then spaces the rest by kind", async () => {
    const { pacer, sleeps } = fakePacer();
    await pacer.waitTurn(1, "create");
    await pacer.waitTurn(1, "create");
    await pacer.waitTurn(1, "edit");
    await pacer.waitTurn(1, "create");
    expect(sleeps).toEqual([5000, 2000, 5000]);
  });

  it("counts time already passed, including across runs", async () => {
    const { pacer, sleeps, tick } = fakePacer();
    await pacer.waitTurn(1, "edit");
    tick(1500);
    await pacer.waitTurn(1, "edit");
    tick(10_000);
    await pacer.waitTurn(1, "create");
    expect(sleeps).toEqual([500]);
  });

  it("keeps different users' writes a server gap apart, each at their own pace", async () => {
    const { pacer, sleeps } = fakePacer();
    await Promise.all([pacer.waitTurn(1, "edit"), pacer.waitTurn(2, "edit")]);
    expect(sleeps).toEqual([1000]);
    // User 1 is still owed their own gap from their first write.
    await pacer.waitTurn(1, "edit");
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("says when a waiting user's turn comes", async () => {
    let wake = () => {};
    const pacer = createEditPacer({
      now: () => 0,
      sleep: () => new Promise((resolve) => (wake = resolve)),
      editGapMs: 2000,
      serverGapMs: 0,
    });
    await pacer.waitTurn(1, "edit");
    expect(pacer.waitingUntil(1)).toBeNull();
    const turn = pacer.waitTurn(1, "edit");
    expect(pacer.waitingUntil(1)).toBe(2000);
    expect(pacer.waitingUntil(2)).toBeNull();
    wake();
    await turn;
    expect(pacer.waitingUntil(1)).toBeNull();
  });
});
