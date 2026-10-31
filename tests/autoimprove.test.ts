import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { autoImproveState } from "../src/autoimprove.ts";

/**
 * The switch has to work without editing code, without a restart and without a
 * config file that can drift from the environment it claims to describe.
 */
describe("auto-amelioration : un interrupteur qui ne depend de rien", () => {
  test("absent, c'est actif", () => {
    assert.equal(autoImproveState({}).enabled, true);
  });

  test("les valeurs d'arret usuelles coupent la fonction", () => {
    for (const value of ["off", "OFF", "0", "false", "no", "disabled", " off "]) {
      assert.equal(autoImproveState({ NOVAHIZ_AUTOIMPROVE: value }).enabled, false, value);
    }
  });

  test("une valeur inconnue ne coupe rien mais se dit", () => {
    const state = autoImproveState({ NOVAHIZ_AUTOIMPROVE: "verbose" });
    assert.equal(state.enabled, true);
    assert.match(state.reason, /verbose/);
  });

  test("la raison nomme la variable, pour etre reproductible", () => {
    assert.match(autoImproveState({ NOVAHIZ_AUTOIMPROVE: "off" }).reason, /NOVAHIZ_AUTOIMPROVE=off/);
  });
});
