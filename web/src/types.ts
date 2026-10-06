export type AuthSource = "local" | "ldap";
export type Role = "admin" | "user";
export type ItemKind = "file" | "folder";
export type Permission = "owner" | "view" | "download" | "edit";
export type Visibility = "public" | "restricted";

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  auth_source: AuthSource;
  role: Role;
  is_active: boolean;
  quota_bytes: number;
  used_bytes: number;
  created_at: string;
  last_login_at: string | null;
}

export interface Item {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  kind: ItemKind;
  mime_type: string | null;
  size_bytes: number;
  is_trashed: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
  shared: boolean;
  permission: Permission;
}

export interface Breadcrumb {
  id: string | null;
  name: string;
}

export interface ItemListResponse {
  items: Item[];
  breadcrumbs: Breadcrumb[];
  current: Item | null;
}

export interface ShareGrant {
  user_id: string;
  username: string;
  display_name: string;
  email: string;
  permission: Permission;
}

export interface Share {
  id: string;
  item_id: string;
  owner_id: string;
  token: string;
  visibility: Visibility;
  permission: Permission;
  has_password: boolean;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  item: Item;
  grants: ShareGrant[];
  url: string;
}

export interface PublicShareMeta {
  token: string;
  name: string;
  kind: ItemKind;
  mime_type: string | null;
  size_bytes: number;
  permission: Permission;
  needs_password: boolean;
  unlocked: boolean;
  owner_name: string;
  children: Item[];
}

export interface Health {
  ok: boolean;
  name: string;
  ldap_enabled: boolean;
  allow_register: boolean;
}

export interface Stats {
  users: number;
  files: number;
  folders: number;
  shares: number;
  used_bytes: number;
}

export interface AppSettings {
  app_name: string;
  allow_register: boolean;
  ldap_enabled: boolean;
  ldap_server: string;
  ldap_port: number;
  ldap_use_ssl: boolean;
  ldap_start_tls: boolean;
  ldap_base_dn: string;
  ldap_domain: string;
  ldap_user_filter: string;
  max_upload_mb: number;
  default_quota_gb: number;
}

export interface UserSearch {
  id: string;
  username: string;
  display_name: string;
  email: string;
}
