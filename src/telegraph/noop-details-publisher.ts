import type { TechnicalDetailsPublisher, TechnicalDetailsPublishRequest } from "./types.js";

export class NoopDetailsPublisher implements TechnicalDetailsPublisher {
  async publish(_request: TechnicalDetailsPublishRequest): Promise<string | null> {
    return null;
  }

  async flush(): Promise<void> {}

  reset(): void {}
}
