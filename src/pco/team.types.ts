// Team-specific attribute shapes for Planning Center Services API.

export interface TeamAttrs {
  name: string;
  sequence: number;
  schedule_to: string;
  default_status: string;
  default_prepare_notifications: boolean;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberAttrs {
  photo_url: string | null;
  photo_thumbnail_url: string | null;
  preferred_app: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanPersonAttrs {
  status: string;
  name: string;
  team_position_name: string | null;
  can_accept_partial: boolean;
  notification_changes_to_household: boolean;
  notification_sender_name: string | null;
  prepare_notification: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlockoutAttrs {
  reason: string | null;
  group_identifier: string | null;
  repeat_frequency: string | null;
  repeat_interval: number | null;
  repeat_period: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
}
