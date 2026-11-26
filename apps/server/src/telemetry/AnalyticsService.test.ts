import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Analytics from "./AnalyticsService.ts";

it.effect("does not queue product analytics events", () =>
  Effect.gen(function* () {
    const analytics = yield* Analytics.AnalyticsService;
    expect(yield* analytics.record("test.event", { answer: 42 })).toBe(false);
    expect(yield* analytics.record("test.anonymous", {}, { anonymous: true })).toBe(false);
    yield* analytics.recordOwners([], "server");
    yield* analytics.flush;
  }).pipe(Effect.provide(Analytics.layer)),
);
