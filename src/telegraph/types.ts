export interface TelegraphConfig {
  enabled: boolean;
  accessToken: string;
  authorName: string;
  timeoutMs: number;
  maxChars: number;
}

export interface TechnicalDetailsPublishRequest {
  title: string;
  body: string;
}

export interface TechnicalDetailsPublisher {
  publish(request: TechnicalDetailsPublishRequest): Promise<string | null>;
  flush(): Promise<void>;
  reset(): void;
}
