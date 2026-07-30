export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      actors: {
        Row: {
          created_at: string
          display_name: string
          id: string
          nexus: Database["public"]["Enums"]["actor_nexus"]
          note: string | null
          sort_order: number
          status: Database["public"]["Enums"]["actor_status"]
          tracked_groups: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          nexus: Database["public"]["Enums"]["actor_nexus"]
          note?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["actor_status"]
          tracked_groups?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          nexus?: Database["public"]["Enums"]["actor_nexus"]
          note?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["actor_status"]
          tracked_groups?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      adversaries: {
        Row: {
          community_identifiers: string[] | null
          country: string | null
          created_at: string
          cs_id: string | null
          description: string | null
          first_seen: string | null
          id: string
          internal_alternative_names: string[] | null
          last_seen: string | null
          motivation: string[] | null
          name: string
          nexus: Database["public"]["Enums"]["actor_nexus"]
          objectives: string[] | null
          short_description: string | null
          status: string | null
          targeting_profile: string[] | null
          updated_at: string
        }
        Insert: {
          community_identifiers?: string[] | null
          country?: string | null
          created_at?: string
          cs_id?: string | null
          description?: string | null
          first_seen?: string | null
          id?: string
          internal_alternative_names?: string[] | null
          last_seen?: string | null
          motivation?: string[] | null
          name: string
          nexus?: Database["public"]["Enums"]["actor_nexus"]
          objectives?: string[] | null
          short_description?: string | null
          status?: string | null
          targeting_profile?: string[] | null
          updated_at?: string
        }
        Update: {
          community_identifiers?: string[] | null
          country?: string | null
          created_at?: string
          cs_id?: string | null
          description?: string | null
          first_seen?: string | null
          id?: string
          internal_alternative_names?: string[] | null
          last_seen?: string | null
          motivation?: string[] | null
          name?: string
          nexus?: Database["public"]["Enums"]["actor_nexus"]
          objectives?: string[] | null
          short_description?: string | null
          status?: string | null
          targeting_profile?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      allowed_users: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      breaches: {
        Row: {
          created_at: string
          event_date: string | null
          event_date_label: string | null
          id: string
          org_name: string
          raw_hash: string
          source_id: string | null
          source_name: string | null
          summary: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          event_date?: string | null
          event_date_label?: string | null
          id?: string
          org_name: string
          raw_hash: string
          source_id?: string | null
          source_name?: string | null
          summary?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          event_date?: string | null
          event_date_label?: string | null
          id?: string
          org_name?: string
          raw_hash?: string
          source_id?: string | null
          source_name?: string | null
          summary?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "breaches_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_items: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          raw_hash: string
          title: string | null
          url: string | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          raw_hash: string
          title?: string | null
          url?: string | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          raw_hash?: string
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      executive_summaries: {
        Row: {
          citations: Json | null
          created_at: string
          generated_at: string
          id: string
          model: string | null
          source: string
          summary: string
          window_note: string | null
        }
        Insert: {
          citations?: Json | null
          created_at?: string
          generated_at?: string
          id?: string
          model?: string | null
          source?: string
          summary: string
          window_note?: string | null
        }
        Update: {
          citations?: Json | null
          created_at?: string
          generated_at?: string
          id?: string
          model?: string | null
          source?: string
          summary?: string
          window_note?: string | null
        }
        Relationships: []
      }
      hidden_items: {
        Row: {
          created_at: string
          raw_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          raw_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          raw_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      intel_item_iocs: {
        Row: {
          created_at: string
          intel_item_id: string
          ioc_id: string
        }
        Insert: {
          created_at?: string
          intel_item_id: string
          ioc_id: string
        }
        Update: {
          created_at?: string
          intel_item_id?: string
          ioc_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intel_item_iocs_intel_item_id_fkey"
            columns: ["intel_item_id"]
            isOneToOne: false
            referencedRelation: "intel_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_item_iocs_intel_item_id_fkey"
            columns: ["intel_item_id"]
            isOneToOne: false
            referencedRelation: "timeline_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_item_iocs_ioc_id_fkey"
            columns: ["ioc_id"]
            isOneToOne: false
            referencedRelation: "iocs"
            referencedColumns: ["id"]
          },
        ]
      }
      intel_items: {
        Row: {
          actor_id: string | null
          adversary_label: string | null
          confidence: Database["public"]["Enums"]["confidence_level"] | null
          created_at: string
          crowdstrike_adversary: string | null
          description: string | null
          id: string
          item_type: Database["public"]["Enums"]["item_type"]
          published_at: string
          raw_hash: string
          source_id: string | null
          source_name: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          actor_id?: string | null
          adversary_label?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string
          crowdstrike_adversary?: string | null
          description?: string | null
          id?: string
          item_type: Database["public"]["Enums"]["item_type"]
          published_at: string
          raw_hash: string
          source_id?: string | null
          source_name?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          actor_id?: string | null
          adversary_label?: string | null
          confidence?: Database["public"]["Enums"]["confidence_level"] | null
          created_at?: string
          crowdstrike_adversary?: string | null
          description?: string | null
          id?: string
          item_type?: Database["public"]["Enums"]["item_type"]
          published_at?: string
          raw_hash?: string
          source_id?: string | null
          source_name?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intel_items_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "actors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intel_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      iocs: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          ioc_type: string
          updated_at: string
          value: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          ioc_type: string
          updated_at?: string
          value: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          ioc_type?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      refresh_runs: {
        Row: {
          finished_at: string | null
          id: string
          items_added: number
          items_updated: number
          log: string | null
          started_at: string
          status: Database["public"]["Enums"]["refresh_status"]
        }
        Insert: {
          finished_at?: string | null
          id?: string
          items_added?: number
          items_updated?: number
          log?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["refresh_status"]
        }
        Update: {
          finished_at?: string | null
          id?: string
          items_added?: number
          items_updated?: number
          log?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["refresh_status"]
        }
        Relationships: []
      }
      sources: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["source_category"]
          created_at: string
          feed_type: string
          feed_url: string | null
          id: string
          last_error: string | null
          last_fetched_at: string | null
          last_item_at: string | null
          name: string
          updated_at: string
          url: string | null
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["source_category"]
          created_at?: string
          feed_type?: string
          feed_url?: string | null
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          last_item_at?: string | null
          name: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["source_category"]
          created_at?: string
          feed_type?: string
          feed_url?: string | null
          id?: string
          last_error?: string | null
          last_fetched_at?: string | null
          last_item_at?: string | null
          name?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      vulnerabilities: {
        Row: {
          added_at: string
          created_at: string
          cve_id: string
          detail: string | null
          id: string
          raw_hash: string
          source_id: string | null
          source_name: string | null
          status: Database["public"]["Enums"]["vuln_status"]
          target: string | null
          updated_at: string
          url: string | null
        }
        Insert: {
          added_at?: string
          created_at?: string
          cve_id: string
          detail?: string | null
          id?: string
          raw_hash: string
          source_id?: string | null
          source_name?: string | null
          status: Database["public"]["Enums"]["vuln_status"]
          target?: string | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          added_at?: string
          created_at?: string
          cve_id?: string
          detail?: string | null
          id?: string
          raw_hash?: string
          source_id?: string | null
          source_name?: string | null
          status?: Database["public"]["Enums"]["vuln_status"]
          target?: string | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vulnerabilities_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      timeline_events: {
        Row: {
          country: string | null
          description: string | null
          id: string | null
          published_at: string | null
          source_name: string | null
          title: string | null
          url: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      is_allowed_user: { Args: never; Returns: boolean }
    }
    Enums: {
      actor_nexus:
        | "china"
        | "russia"
        | "north_korea"
        | "iran"
        | "other"
        | "rest_of_world"
      actor_status: "active" | "quiet"
      confidence_level: "confirmed" | "suspected" | "poc"
      item_type: "actor_activity" | "breach" | "vuln" | "report" | "breaking"
      refresh_status: "running" | "success" | "error"
      source_category: "vendor" | "research" | "news" | "government"
      vuln_status: "confirmed" | "poc" | "suspected"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
    Enums: {
      actor_nexus: [
        "china",
        "russia",
        "north_korea",
        "iran",
        "other",
        "rest_of_world",
      ],
      actor_status: ["active", "quiet"],
      confidence_level: ["confirmed", "suspected", "poc"],
      item_type: ["actor_activity", "breach", "vuln", "report", "breaking"],
      refresh_status: ["running", "success", "error"],
      source_category: ["vendor", "research", "news", "government"],
      vuln_status: ["confirmed", "poc", "suspected"],
    },
  },
} as const

