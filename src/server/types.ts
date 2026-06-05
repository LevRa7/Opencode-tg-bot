export interface SubdomainRow {
  user_id: number;
  username: string;
  subdomain: string;
  kind: "host" | "tenant" | "ssh-host" | "ssh-docker";
  ssh_connection_id: string | null;
  hostname: string | null;
  created_at: string;
}
