export interface FileModel {
  id: string;
  order_id: string;
  original_name: string;
  mime_type: string;
  size: number;
  position: number;
  local_path: string | null;
  r2_key: string | null;
  deleted: boolean;
  created_at: string;
}
