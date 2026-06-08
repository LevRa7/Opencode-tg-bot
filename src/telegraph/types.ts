export interface TelegraphConfig {
  enabled: boolean;
  accessToken: string;
  authorName: string;
  timeoutMs: number;
  maxChars: number;
  translateEnabled: boolean;
  translateApiUrl?: string;
  maxKeysPerUser: number;
  tokenEncryptionKey?: string;
}

export interface TechnicalDetailsPublishRequest {
  title: string;
  body: string;
  locale?: string;
}

export interface TechnicalDetailsPublisher {
  publish(request: TechnicalDetailsPublishRequest): Promise<string | null>;
  flush(): Promise<void>;
  reset(): void;
}

export interface CreatePageResult {
  url: string;
  path: string;
}

export interface TelegraphPageClient {
  createPage(title: string, body: string): Promise<CreatePageResult | null>;
  editPage(path: string, title: string, body: string): Promise<boolean>;
}
