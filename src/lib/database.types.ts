export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      completions: {
        Row: {
          amount: number
          completed_at: string
          id: string
          period_start: string
          task_id: string
          user_id: string
        }
        Insert: {
          amount?: number
          completed_at?: string
          id?: string
          period_start: string
          task_id: string
          user_id?: string
        }
        Update: {
          amount?: number
          completed_at?: string
          id?: string
          period_start?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "completions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          completed_at: string | null
          created_at: string
          ends_at: string
          external_id: string | null
          game_id: string
          hidden: boolean
          id: string
          name: string
          note: string | null
          remind: boolean
          source: string
          starts_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          ends_at: string
          external_id?: string | null
          game_id: string
          hidden?: boolean
          id?: string
          name: string
          note?: string | null
          remind?: boolean
          source?: string
          starts_at?: string | null
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          ends_at?: string
          external_id?: string | null
          game_id?: string
          hidden?: boolean
          id?: string
          name?: string
          note?: string | null
          remind?: boolean
          source?: string
          starts_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          daily_reset_time: string
          id: string
          name: string
          notify_events: boolean
          notify_nudge: boolean
          notify_stamina: boolean
          preset_id: string | null
          preset_version: number | null
          server: string | null
          skipped_until: string | null
          sort_order: number
          timezone: string
          user_id: string
          weekly_reset_day: number
        }
        Insert: {
          created_at?: string
          daily_reset_time?: string
          id?: string
          name: string
          notify_events?: boolean
          notify_nudge?: boolean
          notify_stamina?: boolean
          preset_id?: string | null
          preset_version?: number | null
          server?: string | null
          skipped_until?: string | null
          sort_order?: number
          timezone?: string
          user_id?: string
          weekly_reset_day?: number
        }
        Update: {
          created_at?: string
          daily_reset_time?: string
          id?: string
          name?: string
          notify_events?: boolean
          notify_nudge?: boolean
          notify_stamina?: boolean
          preset_id?: string | null
          preset_version?: number | null
          server?: string | null
          skipped_until?: string | null
          sort_order?: number
          timezone?: string
          user_id?: string
          weekly_reset_day?: number
        }
        Relationships: []
      }
      notify_log: {
        Row: {
          dedupe_key: string
          id: number
          kind: string
          sent_at: string
          user_id: string
        }
        Insert: {
          dedupe_key: string
          id?: never
          kind: string
          sent_at?: string
          user_id: string
        }
        Update: {
          dedupe_key?: string
          id?: never
          kind?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stamina_meters: {
        Row: {
          cap: number
          created_at: string
          current_value: number
          fills_when_full_of: string | null
          game_id: string
          id: string
          minutes_per_point: number
          name: string
          preset_key: string | null
          sort_order: number
          spend_presets: number[]
          user_id: string
          value_recorded_at: string
          warn_minutes: number
        }
        Insert: {
          cap: number
          created_at?: string
          current_value?: number
          fills_when_full_of?: string | null
          game_id: string
          id?: string
          minutes_per_point: number
          name: string
          preset_key?: string | null
          sort_order?: number
          spend_presets?: number[]
          user_id?: string
          value_recorded_at?: string
          warn_minutes?: number
        }
        Update: {
          cap?: number
          created_at?: string
          current_value?: number
          fills_when_full_of?: string | null
          game_id?: string
          id?: string
          minutes_per_point?: number
          name?: string
          preset_key?: string | null
          sort_order?: number
          spend_presets?: number[]
          user_id?: string
          value_recorded_at?: string
          warn_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "stamina_meters_fills_when_full_of_fkey"
            columns: ["fills_when_full_of"]
            isOneToOne: false
            referencedRelation: "stamina_meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stamina_meters_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived: boolean
          category: string
          created_at: string
          cycle_anchor: string | null
          cycle_days: number | null
          cycle_ends_at: string | null
          due_at: string | null
          frequency: string
          game_id: string
          hidden: boolean
          id: string
          monthly_day: number | null
          note: string | null
          optional: boolean
          preset_key: string | null
          sort_order: number
          title: string
          user_id: string
          weekly_target: number | null
        }
        Insert: {
          archived?: boolean
          category?: string
          created_at?: string
          cycle_anchor?: string | null
          cycle_days?: number | null
          cycle_ends_at?: string | null
          due_at?: string | null
          frequency?: string
          game_id: string
          hidden?: boolean
          id?: string
          monthly_day?: number | null
          note?: string | null
          optional?: boolean
          preset_key?: string | null
          sort_order?: number
          title: string
          user_id?: string
          weekly_target?: number | null
        }
        Update: {
          archived?: boolean
          category?: string
          created_at?: string
          cycle_anchor?: string | null
          cycle_days?: number | null
          cycle_ends_at?: string | null
          due_at?: string | null
          frequency?: string
          game_id?: string
          hidden?: boolean
          id?: string
          monthly_day?: number | null
          note?: string | null
          optional?: boolean
          preset_key?: string | null
          sort_order?: number
          title?: string
          user_id?: string
          weekly_target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          event_reminder_days: number
          last_event_import_at: string | null
          last_reminder_run_at: string | null
          nudge_enabled: boolean
          nudge_time: string
          quiet_end: string | null
          quiet_start: string | null
          reset_message_enabled: boolean
          timezone: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_reminder_days?: number
          last_event_import_at?: string | null
          last_reminder_run_at?: string | null
          nudge_enabled?: boolean
          nudge_time?: string
          quiet_end?: string | null
          quiet_start?: string | null
          reset_message_enabled?: boolean
          timezone?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          event_reminder_days?: number
          last_event_import_at?: string | null
          last_reminder_run_at?: string | null
          nudge_enabled?: boolean
          nudge_time?: string
          quiet_end?: string | null
          quiet_start?: string | null
          reset_message_enabled?: boolean
          timezone?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
