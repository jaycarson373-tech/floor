export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      players: {
        Row: {
          id: string;
          name: string;
          gx: number;
          gy: number;
          facing: "north" | "south" | "east" | "west";
          wallet_address: string | null;
          ranked: boolean;
          ranked_checked_at: string | null;
          gate_balance: number;
          last_seen: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          gx?: number;
          gy?: number;
          facing?: "north" | "south" | "east" | "west";
          wallet_address?: string | null;
          ranked?: boolean;
          ranked_checked_at?: string | null;
          gate_balance?: number;
          last_seen?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          gx?: number;
          gy?: number;
          facing?: "north" | "south" | "east" | "west";
          wallet_address?: string | null;
          ranked?: boolean;
          ranked_checked_at?: string | null;
          gate_balance?: number;
          last_seen?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      player_credits: {
        Row: {
          player_id: string;
          credits: number;
          created_at: string;
        };
        Insert: {
          player_id: string;
          credits?: number;
          created_at?: string;
        };
        Update: {
          player_id?: string;
          credits?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_credits_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: true;
            referencedRelation: "players";
            referencedColumns: ["id"];
          }
        ];
      };
      assets: {
        Row: {
          id: string;
          symbol: string;
          name: string;
          base_price: number;
          volatility: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          symbol: string;
          name: string;
          base_price: number;
          volatility: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          symbol?: string;
          name?: string;
          base_price?: number;
          volatility?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      price_ticks: {
        Row: {
          id: string;
          asset_id: string;
          price: number;
          tick_seed: string;
          tick_window: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          asset_id: string;
          price: number;
          tick_seed: string;
          tick_window: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          asset_id?: string;
          price?: number;
          tick_seed?: string;
          tick_window?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "price_ticks_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          }
        ];
      };
      positions: {
        Row: {
          id: string;
          player_id: string;
          asset_id: string;
          qty: number;
          avg_cost: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          asset_id: string;
          qty?: number;
          avg_cost?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          asset_id?: string;
          qty?: number;
          avg_cost?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "positions_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positions_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          }
        ];
      };
      orders: {
        Row: {
          id: string;
          player_id: string;
          asset_id: string;
          side: "buy" | "sell";
          qty: number;
          fill_price: number;
          idempotency_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          player_id: string;
          asset_id: string;
          side: "buy" | "sell";
          qty: number;
          fill_price: number;
          idempotency_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          player_id?: string;
          asset_id?: string;
          side?: "buy" | "sell";
          qty?: number;
          fill_price?: number;
          idempotency_key?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_asset_id_fkey";
            columns: ["asset_id"];
            isOneToOne: false;
            referencedRelation: "assets";
            referencedColumns: ["id"];
          }
        ];
      };
      duels: {
        Row: {
          id: string;
          asset_id: string;
          stake: number;
          player_a: string;
          player_b: string | null;
          player_a_side: "long" | "short";
          player_b_side: "long" | "short" | null;
          status: "open" | "locked" | "revealing" | "settled" | "cancelled";
          ranked: boolean;
          commit_hash: string;
          seed: string;
          winner: string | null;
          player_a_pnl: number | null;
          player_b_pnl: number | null;
          start_price: number;
          end_price: number | null;
          idempotency_key: string;
          accept_idempotency_key: string | null;
          settle_idempotency_key: string | null;
          started_at: string | null;
          settled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          asset_id: string;
          stake: number;
          player_a: string;
          player_b?: string | null;
          player_a_side: "long" | "short";
          player_b_side?: "long" | "short" | null;
          status?: "open" | "locked" | "revealing" | "settled" | "cancelled";
          ranked?: boolean;
          commit_hash: string;
          seed: string;
          winner?: string | null;
          player_a_pnl?: number | null;
          player_b_pnl?: number | null;
          start_price: number;
          end_price?: number | null;
          idempotency_key: string;
          accept_idempotency_key?: string | null;
          settle_idempotency_key?: string | null;
          started_at?: string | null;
          settled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          asset_id?: string;
          stake?: number;
          player_a?: string;
          player_b?: string | null;
          player_a_side?: "long" | "short";
          player_b_side?: "long" | "short" | null;
          status?: "open" | "locked" | "revealing" | "settled" | "cancelled";
          ranked?: boolean;
          commit_hash?: string;
          seed?: string;
          winner?: string | null;
          player_a_pnl?: number | null;
          player_b_pnl?: number | null;
          start_price?: number;
          end_price?: number | null;
          idempotency_key?: string;
          accept_idempotency_key?: string | null;
          settle_idempotency_key?: string | null;
          started_at?: string | null;
          settled_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      ranked_duel_results: {
        Row: {
          id: string;
          duel_id: string;
          player_id: string;
          pnl: number;
          won: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          duel_id: string;
          player_id: string;
          pnl: number;
          won: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          duel_id?: string;
          player_id?: string;
          pnl?: number;
          won?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      ranked_leaderboard: {
        Row: {
          player_id: string;
          name: string;
          wallet_address: string;
          ranked_pnl: number;
          ranked_duels: number;
          ranked_wins: number;
          tier: string;
        };
      };
      sandbox_leaderboard: {
        Row: {
          player_id: string;
          name: string;
          wallet_address: string | null;
          ranked: boolean;
          sandbox_pnl: number;
          duels_played: number;
        };
      };
    };
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
};
