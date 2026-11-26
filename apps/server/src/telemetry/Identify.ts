import * as Schema from "effect/Schema";

/**
 * Retained type shape for the remaining server/client compatibility code.
 * This fork never records or exports owner hashes.
 */
export const TelemetryOwnerSource = Schema.Literals(["connect", "device"]);
export type TelemetryOwnerSource = typeof TelemetryOwnerSource.Type;

export interface TelemetryOwner {
  readonly source: TelemetryOwnerSource;
  readonly ownerId: string;
}
