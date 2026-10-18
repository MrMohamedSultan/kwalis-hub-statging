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
  public: {
    Tables: {
      access_requests: {
        Row: {
          admin_notes: string | null
          company: string | null
          created_at: string
          email: string
          id: string
          industry: string | null
          message: string | null
          mobile: string | null
          name: string
          organization_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          company?: string | null
          created_at?: string
          email: string
          id?: string
          industry?: string | null
          message?: string | null
          mobile?: string | null
          name: string
          organization_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          industry?: string | null
          message?: string | null
          mobile?: string | null
          name?: string
          organization_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      accommodations: {
        Row: {
          check_in_date: string | null
          check_out_date: string | null
          created_at: string
          created_by: string | null
          hotel_name: string | null
          id: string
          notes: string | null
          organization_id: string | null
          person_id: string
          project_id: string | null
          property_id: string | null
          room_number: string | null
          room_type_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by?: string | null
          hotel_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_id: string
          project_id?: string | null
          property_id?: string | null
          room_number?: string | null
          room_type_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by?: string | null
          hotel_name?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_id?: string
          project_id?: string | null
          property_id?: string | null
          room_number?: string | null
          room_type_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accommodations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accommodations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accommodations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "accommodations_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "lodging_properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accommodations_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "lodging_room_types"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_history: {
        Row: {
          actor_id: string | null
          changed_fields: Json
          created_at: string
          id: string
          new_row: Json | null
          old_row: Json | null
          operation: string
          organization_id: string | null
          project_id: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          actor_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          operation: string
          organization_id?: string | null
          project_id?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          actor_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          operation?: string
          organization_id?: string | null
          project_id?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          category: string
          created_at: string
          details: Json
          entity: string | null
          id: string
          organization_id: string | null
          project_id: string | null
          severity: string
          summary: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          category: string
          created_at?: string
          details?: Json
          entity?: string | null
          id?: string
          organization_id?: string | null
          project_id?: string | null
          severity?: string
          summary: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          category?: string
          created_at?: string
          details?: Json
          entity?: string | null
          id?: string
          organization_id?: string | null
          project_id?: string | null
          severity?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      auth_security_log: {
        Row: {
          admin_unlocked: boolean | null
          attempt_count: number | null
          created_at: string | null
          email: string
          event_type: string
          id: string
          lock_duration_minutes: number | null
          unlocked_at: string | null
          unlocked_by: string | null
          user_agent: string | null
        }
        Insert: {
          admin_unlocked?: boolean | null
          attempt_count?: number | null
          created_at?: string | null
          email: string
          event_type: string
          id?: string
          lock_duration_minutes?: number | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          user_agent?: string | null
        }
        Update: {
          admin_unlocked?: boolean | null
          attempt_count?: number | null
          created_at?: string | null
          email?: string
          event_type?: string
          id?: string
          lock_duration_minutes?: number | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      budget_approvers: {
        Row: {
          created_at: string
          decided_at: string | null
          decision: string
          id: string
          note: string | null
          organization_id: string | null
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
          note?: string | null
          organization_id?: string | null
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
          note?: string | null
          organization_id?: string | null
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_approvers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_approvers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          amount: number
          character_id: string | null
          created_at: string
          currency: string
          description: string
          excluded: boolean
          group: string
          header_code: string
          id: string
          main_code: string
          name: string | null
          notes: string | null
          organization_id: string | null
          prep: number
          project_id: string | null
          rate: number
          rebate_eligible: boolean
          shooting: number
          topsheet_code: string | null
          unit: string
          upload_batch_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          version_id: string | null
          wrap: number
          x: number
        }
        Insert: {
          amount?: number
          character_id?: string | null
          created_at?: string
          currency?: string
          description: string
          excluded?: boolean
          group?: string
          header_code: string
          id?: string
          main_code: string
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          prep?: number
          project_id?: string | null
          rate?: number
          rebate_eligible?: boolean
          shooting?: number
          topsheet_code?: string | null
          unit?: string
          upload_batch_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version_id?: string | null
          wrap?: number
          x?: number
        }
        Update: {
          amount?: number
          character_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          excluded?: boolean
          group?: string
          header_code?: string
          id?: string
          main_code?: string
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          prep?: number
          project_id?: string | null
          rate?: number
          rebate_eligible?: boolean
          shooting?: number
          topsheet_code?: string | null
          unit?: string
          upload_batch_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version_id?: string | null
          wrap?: number
          x?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "budget_lines_topsheet_code_fkey"
            columns: ["topsheet_code"]
            isOneToOne: false
            referencedRelation: "budget_topsheet_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "budget_lines_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "budget_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "budget_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_status_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          from_status: string | null
          id: string
          metadata: Json
          note: string | null
          organization_id: string | null
          project_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id?: string | null
          project_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          note?: string | null
          organization_id?: string | null
          project_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_status_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_status_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      budget_topsheet_accounts: {
        Row: {
          code: string
          created_at: string
          default_pct: number | null
          display_order: number
          is_locked: boolean
          name: string
          section: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_pct?: number | null
          display_order?: number
          is_locked?: boolean
          name: string
          section: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_pct?: number | null
          display_order?: number
          is_locked?: boolean
          name?: string
          section?: string
          updated_at?: string
        }
        Relationships: []
      }
      budget_upload_batches: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          note: string | null
          organization_id: string
          project_id: string
          replaced_snapshot: Json | null
          row_count: number
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          note?: string | null
          organization_id: string
          project_id: string
          replaced_snapshot?: Json | null
          row_count?: number
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          project_id?: string
          replaced_snapshot?: Json | null
          row_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_upload_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_upload_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_upload_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      budget_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string | null
          project_id: string
          published_at: string | null
          status: string
          updated_at: string
          version_name: string
          version_no: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          project_id: string
          published_at?: string | null
          status?: string
          updated_at?: string
          version_name: string
          version_no?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string
          published_at?: string | null
          status?: string
          updated_at?: string
          version_name?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      car_rentals: {
        Row: {
          budget_code: string | null
          created_at: string
          created_by: string | null
          currency: string
          daily_rate: number
          driver_name: string | null
          driver_person_id: string | null
          id: string
          invoice_id: string | null
          license_plate: string
          make_model: string
          monthly_rate: number
          notes: string | null
          organization_id: string | null
          project_id: string
          rate_type: string
          reconciled_at: string | null
          rental_end_date: string | null
          rental_start_date: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string | null
          vendor_name: string | null
        }
        Insert: {
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_rate?: number
          driver_name?: string | null
          driver_person_id?: string | null
          id?: string
          invoice_id?: string | null
          license_plate: string
          make_model: string
          monthly_rate?: number
          notes?: string | null
          organization_id?: string | null
          project_id: string
          rate_type?: string
          reconciled_at?: string | null
          rental_end_date?: string | null
          rental_start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_rate?: number
          driver_name?: string | null
          driver_person_id?: string | null
          id?: string
          invoice_id?: string | null
          license_plate?: string
          make_model?: string
          monthly_rate?: number
          notes?: string | null
          organization_id?: string | null
          project_id?: string
          rate_type?: string
          reconciled_at?: string | null
          rental_end_date?: string | null
          rental_start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "car_rentals_driver_person_id_fkey"
            columns: ["driver_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_rentals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_rentals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_rentals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "car_rentals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "car_rentals_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_advance_receipts: {
        Row: {
          advance_id: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachment_name: string | null
          attachment_path: string | null
          budget_code: string | null
          created_at: string
          currency: string
          date: string | null
          department: string | null
          description: string | null
          fx_rate: number
          gl_account_id: string | null
          id: string
          linked_budget_line_id: string | null
          method: string
          notes: string | null
          organization_id: string | null
          project_id: string | null
          received_from: string | null
          recipient: string
          status: string
          submitted_by: string | null
          vendor: string | null
        }
        Insert: {
          advance_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          budget_code?: string | null
          created_at?: string
          currency?: string
          date?: string | null
          department?: string | null
          description?: string | null
          fx_rate?: number
          gl_account_id?: string | null
          id?: string
          linked_budget_line_id?: string | null
          method?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          received_from?: string | null
          recipient: string
          status?: string
          submitted_by?: string | null
          vendor?: string | null
        }
        Update: {
          advance_id?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          budget_code?: string | null
          created_at?: string
          currency?: string
          date?: string | null
          department?: string | null
          description?: string | null
          fx_rate?: number
          gl_account_id?: string | null
          id?: string
          linked_budget_line_id?: string | null
          method?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          received_from?: string | null
          recipient?: string
          status?: string
          submitted_by?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_advance_receipts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advance_receipts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      cash_advances: {
        Row: {
          acceptance_status: string
          accepted_at: string | null
          accepted_by: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          crew_member_id: string | null
          currency: string
          expenses: number
          float_gl_id: string | null
          float_type: string
          funding_bank_gl_id: string | null
          fx_rate: number
          holder: string
          id: string
          issued_at: string | null
          notes: string | null
          organization_id: string | null
          parent_advance_id: string | null
          project_id: string | null
          status: string
          total_advance: number
        }
        Insert: {
          acceptance_status?: string
          accepted_at?: string | null
          accepted_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          crew_member_id?: string | null
          currency?: string
          expenses?: number
          float_gl_id?: string | null
          float_type?: string
          funding_bank_gl_id?: string | null
          fx_rate?: number
          holder: string
          id?: string
          issued_at?: string | null
          notes?: string | null
          organization_id?: string | null
          parent_advance_id?: string | null
          project_id?: string | null
          status?: string
          total_advance?: number
        }
        Update: {
          acceptance_status?: string
          accepted_at?: string | null
          accepted_by?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          crew_member_id?: string | null
          currency?: string
          expenses?: number
          float_gl_id?: string | null
          float_type?: string
          funding_bank_gl_id?: string | null
          fx_rate?: number
          holder?: string
          id?: string
          issued_at?: string | null
          notes?: string | null
          organization_id?: string | null
          parent_advance_id?: string | null
          project_id?: string | null
          status?: string
          total_advance?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_advances_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_float_gl_id_fkey"
            columns: ["float_gl_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_funding_bank_gl_id_fkey"
            columns: ["funding_bank_gl_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_parent_advance_id_fkey"
            columns: ["parent_advance_id"]
            isOneToOne: false
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_advances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      character_role_types: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string
          organization_id: string | null
          project_id: string | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          organization_id?: string | null
          project_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          organization_id?: string | null
          project_id?: string | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "character_role_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_role_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_role_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      characters: {
        Row: {
          budget_line_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          episode_id: string | null
          id: string
          name: string
          organization_id: string | null
          project_id: string
          role_type: string
          season_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          episode_id?: string | null
          id?: string
          name: string
          organization_id?: string | null
          project_id: string
          role_type?: string
          season_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_line_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          episode_id?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          project_id?: string
          role_type?: string
          season_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_budget_line_fk"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "characters_budget_line_fk"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_budget_line_fk"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_budget_line_fk"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "characters_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "series_episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "characters_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "series_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_budget_splits: {
        Row: {
          amount: number | null
          budget_code: string | null
          budget_line_id: string | null
          created_at: string
          created_by: string | null
          crew_member_id: string | null
          currency: string
          id: string
          notes: string | null
          organization_id: string | null
          percent: number | null
          person_id: string | null
          project_id: string | null
          split_kind: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number | null
          budget_code?: string | null
          budget_line_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          percent?: number | null
          person_id?: string | null
          project_id?: string | null
          split_kind?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number | null
          budget_code?: string | null
          budget_line_id?: string | null
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          percent?: number | null
          person_id?: string | null
          project_id?: string | null
          split_kind?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_budget_splits_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "contract_budget_splits_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "contract_budget_splits_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_budget_splits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      crew_members: {
        Row: {
          attachment_url: string | null
          contract_path: string | null
          contract_status: string
          contract_uploaded_at: string | null
          created_at: string
          created_by: string | null
          deal_currency: string
          email: string | null
          full_name: string
          header_code: string | null
          iban: string | null
          id: string
          is_auto_generated: boolean
          is_petty_cash_custodian: boolean
          is_purchaser: boolean
          linked_budget_line_id: string | null
          nationality: string
          organization_id: string | null
          phone: string | null
          project_id: string | null
          rejection_note: string | null
          role: string
          sub_account_code: string | null
          total_deal: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attachment_url?: string | null
          contract_path?: string | null
          contract_status?: string
          contract_uploaded_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_currency?: string
          email?: string | null
          full_name: string
          header_code?: string | null
          iban?: string | null
          id?: string
          is_auto_generated?: boolean
          is_petty_cash_custodian?: boolean
          is_purchaser?: boolean
          linked_budget_line_id?: string | null
          nationality?: string
          organization_id?: string | null
          phone?: string | null
          project_id?: string | null
          rejection_note?: string | null
          role?: string
          sub_account_code?: string | null
          total_deal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attachment_url?: string | null
          contract_path?: string | null
          contract_status?: string
          contract_uploaded_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_currency?: string
          email?: string | null
          full_name?: string
          header_code?: string | null
          iban?: string | null
          id?: string
          is_auto_generated?: boolean
          is_petty_cash_custodian?: boolean
          is_purchaser?: boolean
          linked_budget_line_id?: string | null
          nationality?: string
          organization_id?: string | null
          phone?: string | null
          project_id?: string | null
          rejection_note?: string | null
          role?: string
          sub_account_code?: string | null
          total_deal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crew_members_linked_budget_line_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "crew_members_linked_budget_line_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_linked_budget_line_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_linked_budget_line_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "crew_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      daily_transports: {
        Row: {
          car_rental_id: string | null
          created_at: string
          created_by: string | null
          driver_name: string | null
          driver_person_id: string | null
          dropoff_location: string | null
          id: string
          notes: string | null
          organization_id: string | null
          passenger_ids: string[]
          pickup_location: string | null
          pickup_time: string | null
          project_id: string
          transport_date: string
          updated_at: string
          updated_by: string | null
          vehicle_label: string | null
        }
        Insert: {
          car_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_person_id?: string | null
          dropoff_location?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          passenger_ids?: string[]
          pickup_location?: string | null
          pickup_time?: string | null
          project_id: string
          transport_date: string
          updated_at?: string
          updated_by?: string | null
          vehicle_label?: string | null
        }
        Update: {
          car_rental_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_name?: string | null
          driver_person_id?: string | null
          dropoff_location?: string | null
          id?: string
          notes?: string | null
          organization_id?: string | null
          passenger_ids?: string[]
          pickup_location?: string | null
          pickup_time?: string | null
          project_id?: string
          transport_date?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_transports_car_rental_id_fkey"
            columns: ["car_rental_id"]
            isOneToOne: false
            referencedRelation: "car_rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_transports_driver_person_id_fkey"
            columns: ["driver_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_transports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_transports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_transports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      entities: {
        Row: {
          bank: string | null
          cr_no: string | null
          created_at: string
          email: string | null
          entity_type: string
          iban: string | null
          id: string
          id_number: string | null
          metadata: Json
          mobile: string | null
          name: string
          nationality: string | null
          nationality_details: Json | null
          organization_id: string | null
          position: string | null
          project_id: string | null
          resident_status: string
          updated_at: string
          vat_no: string | null
        }
        Insert: {
          bank?: string | null
          cr_no?: string | null
          created_at?: string
          email?: string | null
          entity_type: string
          iban?: string | null
          id?: string
          id_number?: string | null
          metadata?: Json
          mobile?: string | null
          name: string
          nationality?: string | null
          nationality_details?: Json | null
          organization_id?: string | null
          position?: string | null
          project_id?: string | null
          resident_status?: string
          updated_at?: string
          vat_no?: string | null
        }
        Update: {
          bank?: string | null
          cr_no?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string
          iban?: string | null
          id?: string
          id_number?: string | null
          metadata?: Json
          mobile?: string | null
          name?: string
          nationality?: string | null
          nationality_details?: Json | null
          organization_id?: string | null
          position?: string | null
          project_id?: string | null
          resident_status?: string
          updated_at?: string
          vat_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      fx_rate_audit_log: {
        Row: {
          base_currency: string
          changed_at: string
          changed_by: string
          id: string
          new_rate: number
          previous_rate: number | null
          project_id: string
          reason: string | null
          recalculation_status: string | null
          rows_recalculated: number | null
          target_currency: string
        }
        Insert: {
          base_currency: string
          changed_at?: string
          changed_by: string
          id?: string
          new_rate: number
          previous_rate?: number | null
          project_id: string
          reason?: string | null
          recalculation_status?: string | null
          rows_recalculated?: number | null
          target_currency: string
        }
        Update: {
          base_currency?: string
          changed_at?: string
          changed_by?: string
          id?: string
          new_rate?: number
          previous_rate?: number | null
          project_id?: string
          reason?: string | null
          recalculation_status?: string | null
          rows_recalculated?: number | null
          target_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_rate_audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_rate_audit_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_role: Database["public"]["Enums"]["org_role"]
          organization_id: string
          project_id: string | null
          revoked_at: string | null
          role_id: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_role?: Database["public"]["Enums"]["org_role"]
          organization_id: string
          project_id?: string | null
          revoked_at?: string | null
          role_id?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_role?: Database["public"]["Enums"]["org_role"]
          organization_id?: string
          project_id?: string | null
          revoked_at?: string | null
          role_id?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          attachment_url: string | null
          beneficiary_id: string | null
          budget_code: string | null
          created_at: string
          created_by: string | null
          date: string | null
          department: string | null
          description: string
          gl_account_id: string | null
          id: string
          invoice_no: string | null
          invoice_url: string | null
          is_non_saudi_vendor: boolean
          net_payable: number | null
          organization_id: string | null
          payment_term: number
          price: number
          project_id: string | null
          purchaser_id: string | null
          purchaser_name: string | null
          rebate_eligible: boolean
          rebate_manual_override: boolean
          receipt_url: string | null
          service_inside_ksa: boolean
          updated_at: string
          updated_by: string | null
          vat_amount: number
          vatable: boolean
          vendor_name: string | null
          wht_amount: number
          wht_gl_code: string | null
          wht_percent: number
          wht_treatment: string
        }
        Insert: {
          attachment_url?: string | null
          beneficiary_id?: string | null
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          date?: string | null
          department?: string | null
          description: string
          gl_account_id?: string | null
          id?: string
          invoice_no?: string | null
          invoice_url?: string | null
          is_non_saudi_vendor?: boolean
          net_payable?: number | null
          organization_id?: string | null
          payment_term?: number
          price?: number
          project_id?: string | null
          purchaser_id?: string | null
          purchaser_name?: string | null
          rebate_eligible?: boolean
          rebate_manual_override?: boolean
          receipt_url?: string | null
          service_inside_ksa?: boolean
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
          vatable?: boolean
          vendor_name?: string | null
          wht_amount?: number
          wht_gl_code?: string | null
          wht_percent?: number
          wht_treatment?: string
        }
        Update: {
          attachment_url?: string | null
          beneficiary_id?: string | null
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          date?: string | null
          department?: string | null
          description?: string
          gl_account_id?: string | null
          id?: string
          invoice_no?: string | null
          invoice_url?: string | null
          is_non_saudi_vendor?: boolean
          net_payable?: number | null
          organization_id?: string | null
          payment_term?: number
          price?: number
          project_id?: string | null
          purchaser_id?: string | null
          purchaser_name?: string | null
          rebate_eligible?: boolean
          rebate_manual_override?: boolean
          receipt_url?: string | null
          service_inside_ksa?: boolean
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
          vatable?: boolean
          vendor_name?: string | null
          wht_amount?: number
          wht_gl_code?: string | null
          wht_percent?: number
          wht_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "invoices_purchaser_id_fkey"
            columns: ["purchaser_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_doc_path: string | null
          contract_doc_url: string | null
          created_at: string
          created_by: string | null
          currency: string
          daily_rate: number
          id: string
          linked_budget_line_id: string | null
          name: string
          notes: string | null
          organization_id: string | null
          owner_nationality: string | null
          permit_expiry: string | null
          permit_status: string
          project_id: string
          shoot_days: number
          tax_number: string | null
          updated_at: string
          updated_by: string | null
          vat_registered: boolean
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_doc_path?: string | null
          contract_doc_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_rate?: number
          id?: string
          linked_budget_line_id?: string | null
          name: string
          notes?: string | null
          organization_id?: string | null
          owner_nationality?: string | null
          permit_expiry?: string | null
          permit_status?: string
          project_id: string
          shoot_days?: number
          tax_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_registered?: boolean
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_doc_path?: string | null
          contract_doc_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_rate?: number
          id?: string
          linked_budget_line_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          owner_nationality?: string | null
          permit_expiry?: string | null
          permit_status?: string
          project_id?: string
          shoot_days?: number
          tax_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vat_registered?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "locations_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "locations_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      lodging_properties: {
        Row: {
          address: string | null
          city: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          name: string
          notes: string | null
          organization_id: string | null
          project_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string | null
          project_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lodging_properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodging_properties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodging_properties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      lodging_room_types: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          name: string
          nightly_rate: number
          notes: string | null
          occupancy: number
          organization_id: string | null
          project_id: string | null
          property_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name: string
          nightly_rate?: number
          notes?: string | null
          occupancy?: number
          organization_id?: string | null
          project_id?: string | null
          property_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          name?: string
          nightly_rate?: number
          notes?: string | null
          occupancy?: number
          organization_id?: string | null
          project_id?: string | null
          property_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lodging_room_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodging_room_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lodging_room_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "lodging_room_types_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "lodging_properties"
            referencedColumns: ["id"]
          },
        ]
      }
      master_budget: {
        Row: {
          actual_amount: number
          budget_code: string
          category: string | null
          created_at: string
          currency: string
          description: string
          group: string
          id: string
          is_header: boolean
          level: number
          macro_category: Database["public"]["Enums"]["budget_macro_category"]
          organization_id: string | null
          parent_code: string | null
          planned_amount: number
          topsheet_code: string | null
          updated_at: string
        }
        Insert: {
          actual_amount?: number
          budget_code: string
          category?: string | null
          created_at?: string
          currency?: string
          description: string
          group?: string
          id?: string
          is_header?: boolean
          level?: number
          macro_category?: Database["public"]["Enums"]["budget_macro_category"]
          organization_id?: string | null
          parent_code?: string | null
          planned_amount?: number
          topsheet_code?: string | null
          updated_at?: string
        }
        Update: {
          actual_amount?: number
          budget_code?: string
          category?: string | null
          created_at?: string
          currency?: string
          description?: string
          group?: string
          id?: string
          is_header?: boolean
          level?: number
          macro_category?: Database["public"]["Enums"]["budget_macro_category"]
          organization_id?: string | null
          parent_code?: string | null
          planned_amount?: number
          topsheet_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_budget_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "master_budget_parent_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "master_budget"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "master_budget_parent_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "master_budget_parent_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "v_financial_ledger"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "master_budget_topsheet_code_fkey"
            columns: ["topsheet_code"]
            isOneToOne: false
            referencedRelation: "budget_topsheet_accounts"
            referencedColumns: ["code"]
          },
        ]
      }
      modules: {
        Row: {
          icon: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          layer: string
          parent_key: string | null
          route_path: string | null
          sort_order: number
        }
        Insert: {
          icon?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          layer?: string
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number
        }
        Update: {
          icon?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          layer?: string
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "modules_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          id: string
          metadata: Json
          organization_id: string | null
          project_id: string | null
          read_at: string | null
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          read_at?: string | null
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
          project_id?: string | null
          read_at?: string | null
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      organization_documents: {
        Row: {
          created_at: string
          document_type: string
          file_name: string
          file_size_bytes: number | null
          file_url: string
          id: string
          mime_type: string | null
          notes: string | null
          organization_id: string
          updated_at: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          document_type: string
          file_name: string
          file_size_bytes?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          organization_id: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          document_type?: string
          file_name?: string
          file_size_bytes?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          organization_id?: string
          updated_at?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          base_currency: string
          commercial_registration: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          fx_rates: Json
          id: string
          industry: string | null
          logo_url: string | null
          max_projects: number
          name: string
          national_address: string | null
          notes: string | null
          onboarded_at: string | null
          slug: string
          subscription_status: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          base_currency?: string
          commercial_registration?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          fx_rates?: Json
          id?: string
          industry?: string | null
          logo_url?: string | null
          max_projects?: number
          name: string
          national_address?: string | null
          notes?: string | null
          onboarded_at?: string | null
          slug: string
          subscription_status?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          base_currency?: string
          commercial_registration?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          fx_rates?: Json
          id?: string
          industry?: string | null
          logo_url?: string | null
          max_projects?: number
          name?: string
          national_address?: string | null
          notes?: string | null
          onboarded_at?: string | null
          slug?: string
          subscription_status?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      overtime_entries: {
        Row: {
          adjustment: number
          adjustment_reason: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          budget_code: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          organization_id: string | null
          overtime_rate: number
          overtime_unit: string
          paid_at: string | null
          payroll_run_id: string | null
          person_id: string | null
          person_kind: string
          person_name: string
          project_id: string | null
          status: string
          units: number
          updated_at: string
          updated_by: string | null
          work_date: string
        }
        Insert: {
          adjustment?: number
          adjustment_reason?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          overtime_unit?: string
          paid_at?: string | null
          payroll_run_id?: string | null
          person_id?: string | null
          person_kind?: string
          person_name: string
          project_id?: string | null
          status?: string
          units?: number
          updated_at?: string
          updated_by?: string | null
          work_date: string
        }
        Update: {
          adjustment?: number
          adjustment_reason?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          overtime_unit?: string
          paid_at?: string | null
          payroll_run_id?: string | null
          person_id?: string | null
          person_kind?: string
          person_name?: string
          project_id?: string | null
          status?: string
          units?: number
          updated_at?: string
          updated_by?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "overtime_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_entries_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_entries_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          currency: string
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          organization_id: string
          payment_date: string | null
          payment_method: string | null
          previously_paid: number
          project_id: string | null
          proof_path: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_amount: number
          requested_by: string | null
          source_id: string
          source_label: string | null
          source_type: string
          status: string
          submitted_at: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          payment_date?: string | null
          payment_method?: string | null
          previously_paid?: number
          project_id?: string | null
          proof_path?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_amount: number
          requested_by?: string | null
          source_id: string
          source_label?: string | null
          source_type: string
          status?: string
          submitted_at?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          payment_date?: string | null
          payment_method?: string | null
          previously_paid?: number
          project_id?: string | null
          proof_path?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_amount?: number
          requested_by?: string | null
          source_id?: string
          source_label?: string | null
          source_type?: string
          status?: string
          submitted_at?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          notes: string | null
          organization_id: string | null
          payment_date: string
          project_id: string | null
          proof_path: string | null
          recorded_by: string | null
          source_id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string | null
          payment_date?: string
          project_id?: string | null
          proof_path?: string | null
          recorded_by?: string | null
          source_id: string
          source_type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string | null
          payment_date?: string
          project_id?: string | null
          proof_path?: string | null
          recorded_by?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      payroll: {
        Row: {
          budget_code: string | null
          created_at: string
          created_by: string | null
          gl_account_id: string | null
          id: string
          kind: string
          ledger: Json
          name: string
          net_payable: number | null
          organization_id: string | null
          payment_schedule: Json
          payments: Json
          percents: Json
          project_id: string | null
          receipts: Json
          ref_id: string | null
          total_amount: number
          updated_at: string
          updated_by: string | null
          wht_amount: number
          wht_gl_code: string | null
          wht_percent: number
          wht_treatment: string
        }
        Insert: {
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          gl_account_id?: string | null
          id?: string
          kind: string
          ledger?: Json
          name: string
          net_payable?: number | null
          organization_id?: string | null
          payment_schedule?: Json
          payments?: Json
          percents?: Json
          project_id?: string | null
          receipts?: Json
          ref_id?: string | null
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          wht_amount?: number
          wht_gl_code?: string | null
          wht_percent?: number
          wht_treatment?: string
        }
        Update: {
          budget_code?: string | null
          created_at?: string
          created_by?: string | null
          gl_account_id?: string | null
          id?: string
          kind?: string
          ledger?: Json
          name?: string
          net_payable?: number | null
          organization_id?: string | null
          payment_schedule?: Json
          payments?: Json
          percents?: Json
          project_id?: string | null
          receipts?: Json
          ref_id?: string | null
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          wht_amount?: number
          wht_gl_code?: string | null
          wht_percent?: number
          wht_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      payroll_approval_events: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          from_status: string | null
          gross_total: number | null
          id: string
          net_total: number | null
          note: string | null
          organization_id: string | null
          payroll_run_id: string
          project_id: string | null
          to_status: string | null
          wht_total: number | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          gross_total?: number | null
          id?: string
          net_total?: number | null
          note?: string | null
          organization_id?: string | null
          payroll_run_id: string
          project_id?: string | null
          to_status?: string | null
          wht_total?: number | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          from_status?: string | null
          gross_total?: number | null
          id?: string
          net_total?: number | null
          note?: string | null
          organization_id?: string | null
          payroll_run_id?: string
          project_id?: string | null
          to_status?: string | null
          wht_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_approval_events_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          bank_name: string | null
          bank_nationality: string | null
          beneficiary_name: string
          company_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_notes: string | null
          department: string | null
          excludes_vat: number
          iban: string | null
          id: string
          in_process: boolean
          invoice_link: string | null
          kind: string
          organization_id: string
          paid_payments: number[]
          paid_total_sar: number | null
          position_role: string | null
          project_id: string | null
          remaining_sar: number | null
          reserved_budget_sar: number
          scheduled_payments: number[]
          scheduled_total_sar: number | null
          updated_at: string
        }
        Insert: {
          bank_name?: string | null
          bank_nationality?: string | null
          beneficiary_name: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_notes?: string | null
          department?: string | null
          excludes_vat?: number
          iban?: string | null
          id?: string
          in_process?: boolean
          invoice_link?: string | null
          kind: string
          organization_id: string
          paid_payments?: number[]
          paid_total_sar?: number | null
          position_role?: string | null
          project_id?: string | null
          remaining_sar?: number | null
          reserved_budget_sar?: number
          scheduled_payments?: number[]
          scheduled_total_sar?: number | null
          updated_at?: string
        }
        Update: {
          bank_name?: string | null
          bank_nationality?: string | null
          beneficiary_name?: string
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_notes?: string | null
          department?: string | null
          excludes_vat?: number
          iban?: string | null
          id?: string
          in_process?: boolean
          invoice_link?: string | null
          kind?: string
          organization_id?: string
          paid_payments?: number[]
          paid_total_sar?: number | null
          position_role?: string | null
          project_id?: string | null
          remaining_sar?: number | null
          reserved_budget_sar?: number
          scheduled_payments?: number[]
          scheduled_total_sar?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      payroll_run_items: {
        Row: {
          allowances: number
          beneficiary_name: string
          budget_code: string | null
          cadence: string
          created_at: string
          crew_member_id: string | null
          currency: string
          deductions: number
          gross: number
          id: string
          net: number
          notes: string | null
          organization_id: string | null
          payroll_id: string | null
          payroll_run_id: string
          person_id: string | null
          project_id: string | null
          rate: number
          role: string | null
          timesheet_id: string | null
          units: number
          updated_at: string
          wht_amount: number
          wht_percent: number
        }
        Insert: {
          allowances?: number
          beneficiary_name: string
          budget_code?: string | null
          cadence?: string
          created_at?: string
          crew_member_id?: string | null
          currency?: string
          deductions?: number
          gross?: number
          id?: string
          net?: number
          notes?: string | null
          organization_id?: string | null
          payroll_id?: string | null
          payroll_run_id: string
          person_id?: string | null
          project_id?: string | null
          rate?: number
          role?: string | null
          timesheet_id?: string | null
          units?: number
          updated_at?: string
          wht_amount?: number
          wht_percent?: number
        }
        Update: {
          allowances?: number
          beneficiary_name?: string
          budget_code?: string | null
          cadence?: string
          created_at?: string
          crew_member_id?: string | null
          currency?: string
          deductions?: number
          gross?: number
          id?: string
          net?: number
          notes?: string | null
          organization_id?: string | null
          payroll_id?: string | null
          payroll_run_id?: string
          person_id?: string | null
          project_id?: string | null
          rate?: number
          role?: string | null
          timesheet_id?: string | null
          units?: number
          updated_at?: string
          wht_amount?: number
          wht_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_items_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_payroll_id_fkey"
            columns: ["payroll_id"]
            isOneToOne: false
            referencedRelation: "payroll"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "payroll_run_items_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          gross_total: number
          id: string
          kind: string
          label: string
          net_total: number
          notes: string | null
          organization_id: string | null
          pay_date: string | null
          period_end: string
          period_start: string
          posted_at: string | null
          posted_by: string | null
          project_id: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
          wht_total: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_total?: number
          id?: string
          kind?: string
          label: string
          net_total?: number
          notes?: string | null
          organization_id?: string | null
          pay_date?: string | null
          period_end: string
          period_start: string
          posted_at?: string | null
          posted_by?: string | null
          project_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          wht_total?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          gross_total?: number
          id?: string
          kind?: string
          label?: string
          net_total?: number
          notes?: string | null
          organization_id?: string | null
          pay_date?: string | null
          period_end?: string
          period_start?: string
          posted_at?: string | null
          posted_by?: string | null
          project_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
          wht_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      pending_project_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          grant_all_current: boolean
          id: string
          member_role: string
          organization_id: string | null
          project_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          grant_all_current?: boolean
          id?: string
          member_role?: string
          organization_id?: string | null
          project_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          grant_all_current?: boolean
          id?: string
          member_role?: string
          organization_id?: string | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_project_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      people: {
        Row: {
          accommodation_id: string | null
          approval_description: string | null
          approval_reason: string | null
          approval_status: string | null
          attachment_url: string | null
          bank: string | null
          bank_country: string | null
          ccy: string
          character: string | null
          character_id: string | null
          contract_path: string | null
          contract_status: string
          country: string | null
          created_at: string
          created_by: string | null
          daily_rate: number
          deal_type: string
          email: string | null
          end_date: string | null
          full_name: string
          housing_allowance: number | null
          iban: string | null
          iban_attachment_path: string | null
          id: string
          id_attachment_path: string | null
          id_number: string | null
          is_auto_generated: boolean
          is_driver: boolean
          is_petty_cash_custodian: boolean
          is_purchaser: boolean
          kind: string
          linked_budget_line_id: string | null
          nationality: string | null
          off_set_per_diem: number
          on_set_per_diem: number
          organization_id: string | null
          overtime_rate: number | null
          overtime_unit: string | null
          payment_term: number
          per_diem: number
          phone_number: string | null
          position: string | null
          project_id: string | null
          requires_accommodation: boolean
          requires_flight: boolean
          requires_transport: boolean
          shooting_days: number
          start_date: string | null
          swift_code: string | null
          updated_at: string
          updated_by: string | null
          wht_treatment: string
        }
        Insert: {
          accommodation_id?: string | null
          approval_description?: string | null
          approval_reason?: string | null
          approval_status?: string | null
          attachment_url?: string | null
          bank?: string | null
          bank_country?: string | null
          ccy?: string
          character?: string | null
          character_id?: string | null
          contract_path?: string | null
          contract_status?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          deal_type?: string
          email?: string | null
          end_date?: string | null
          full_name: string
          housing_allowance?: number | null
          iban?: string | null
          iban_attachment_path?: string | null
          id?: string
          id_attachment_path?: string | null
          id_number?: string | null
          is_auto_generated?: boolean
          is_driver?: boolean
          is_petty_cash_custodian?: boolean
          is_purchaser?: boolean
          kind: string
          linked_budget_line_id?: string | null
          nationality?: string | null
          off_set_per_diem?: number
          on_set_per_diem?: number
          organization_id?: string | null
          overtime_rate?: number | null
          overtime_unit?: string | null
          payment_term?: number
          per_diem?: number
          phone_number?: string | null
          position?: string | null
          project_id?: string | null
          requires_accommodation?: boolean
          requires_flight?: boolean
          requires_transport?: boolean
          shooting_days?: number
          start_date?: string | null
          swift_code?: string | null
          updated_at?: string
          updated_by?: string | null
          wht_treatment?: string
        }
        Update: {
          accommodation_id?: string | null
          approval_description?: string | null
          approval_reason?: string | null
          approval_status?: string | null
          attachment_url?: string | null
          bank?: string | null
          bank_country?: string | null
          ccy?: string
          character?: string | null
          character_id?: string | null
          contract_path?: string | null
          contract_status?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          daily_rate?: number
          deal_type?: string
          email?: string | null
          end_date?: string | null
          full_name?: string
          housing_allowance?: number | null
          iban?: string | null
          iban_attachment_path?: string | null
          id?: string
          id_attachment_path?: string | null
          id_number?: string | null
          is_auto_generated?: boolean
          is_driver?: boolean
          is_petty_cash_custodian?: boolean
          is_purchaser?: boolean
          kind?: string
          linked_budget_line_id?: string | null
          nationality?: string | null
          off_set_per_diem?: number
          on_set_per_diem?: number
          organization_id?: string | null
          overtime_rate?: number | null
          overtime_unit?: string | null
          payment_term?: number
          per_diem?: number
          phone_number?: string | null
          position?: string | null
          project_id?: string | null
          requires_accommodation?: boolean
          requires_flight?: boolean
          requires_transport?: boolean
          shooting_days?: number
          start_date?: string | null
          swift_code?: string | null
          updated_at?: string
          updated_by?: string | null
          wht_treatment?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_accommodation_id_fkey"
            columns: ["accommodation_id"]
            isOneToOne: false
            referencedRelation: "accommodations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "people_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      per_diem_ledger: {
        Row: {
          budget_code: string | null
          cash_advance_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          linked_budget_line_id: string | null
          notes: string | null
          off_days: number
          off_set_rate: number
          on_set_rate: number
          organization_id: string | null
          period_end: string
          period_start: string
          person_id: string
          project_id: string
          receipt_path: string | null
          shoot_days: number
          status: string
          total_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_code?: string | null
          cash_advance_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          linked_budget_line_id?: string | null
          notes?: string | null
          off_days?: number
          off_set_rate?: number
          on_set_rate?: number
          organization_id?: string | null
          period_end: string
          period_start: string
          person_id: string
          project_id: string
          receipt_path?: string | null
          shoot_days?: number
          status?: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_code?: string | null
          cash_advance_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          linked_budget_line_id?: string | null
          notes?: string | null
          off_days?: number
          off_set_rate?: number
          on_set_rate?: number
          organization_id?: string | null
          period_end?: string
          period_start?: string
          person_id?: string
          project_id?: string
          receipt_path?: string | null
          shoot_days?: number
          status?: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "per_diem_ledger_cash_advance_id_fkey"
            columns: ["cash_advance_id"]
            isOneToOne: false
            referencedRelation: "cash_advances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_ledger_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "per_diem_ledger_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_ledger_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_ledger_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "per_diem_ledger_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "per_diem_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          new_row: Json | null
          old_row: Json | null
          organization_id: string | null
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          organization_id?: string | null
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          organization_id?: string | null
          target_id?: string | null
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      picture_assets: {
        Row: {
          agreed_cost: number
          budget_code: string | null
          contract_file_name: string | null
          contract_file_path: string | null
          contract_url: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          end_date: string | null
          id: string
          kind: string
          notes: string | null
          organization_id: string | null
          owner_contact: string | null
          owner_id_doc_name: string | null
          owner_id_doc_path: string | null
          owner_id_number: string | null
          owner_name: string | null
          owner_nationality: string | null
          paid_amount: number | null
          paid_at: string | null
          payment_reference: string | null
          payment_source: string | null
          payment_status: string
          preferred_payment_method: string | null
          project_id: string
          start_date: string | null
          updated_at: string
          updated_by: string | null
          usage: string | null
          vehicle_license_name: string | null
          vehicle_license_path: string | null
        }
        Insert: {
          agreed_cost?: number
          budget_code?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          contract_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          end_date?: string | null
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string | null
          owner_contact?: string | null
          owner_id_doc_name?: string | null
          owner_id_doc_path?: string | null
          owner_id_number?: string | null
          owner_name?: string | null
          owner_nationality?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_reference?: string | null
          payment_source?: string | null
          payment_status?: string
          preferred_payment_method?: string | null
          project_id: string
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          usage?: string | null
          vehicle_license_name?: string | null
          vehicle_license_path?: string | null
        }
        Update: {
          agreed_cost?: number
          budget_code?: string | null
          contract_file_name?: string | null
          contract_file_path?: string | null
          contract_url?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          end_date?: string | null
          id?: string
          kind?: string
          notes?: string | null
          organization_id?: string | null
          owner_contact?: string | null
          owner_id_doc_name?: string | null
          owner_id_doc_path?: string | null
          owner_id_number?: string | null
          owner_name?: string | null
          owner_nationality?: string | null
          paid_amount?: number | null
          paid_at?: string | null
          payment_reference?: string | null
          payment_source?: string | null
          payment_status?: string
          preferred_payment_method?: string | null
          project_id?: string
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
          usage?: string | null
          vehicle_license_name?: string | null
          vehicle_license_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picture_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picture_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email_verified_at: string | null
          executive_title: string | null
          id: string
          job_title: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_verified_at?: string | null
          executive_title?: string | null
          id: string
          job_title?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_verified_at?: string | null
          executive_title?: string | null
          id?: string
          job_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_files: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          file_url: string | null
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          organization_id: string | null
          original_file_name: string | null
          project_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          organization_id?: string | null
          original_file_name?: string | null
          project_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          organization_id?: string | null
          original_file_name?: string | null
          project_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_folders: {
        Row: {
          auto_generated: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string | null
          parent_id: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id?: string | null
          parent_id?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          parent_id?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_folders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_fx_rates: {
        Row: {
          base_currency: string
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          is_active: boolean
          project_id: string
          rate: number
          target_currency: string
          updated_at: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean
          project_id: string
          rate?: number
          target_currency?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          is_active?: boolean
          project_id?: string
          rate?: number
          target_currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_fx_rates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_fx_rates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          executive_title:
            | Database["public"]["Enums"]["executive_title_enum"]
            | null
          id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          executive_title?:
            | Database["public"]["Enums"]["executive_title_enum"]
            | null
          id?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          executive_title?:
            | Database["public"]["Enums"]["executive_title_enum"]
            | null
          id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          base_currency: string | null
          budget: number
          budget_locked_at: string | null
          budget_locked_by: string | null
          budget_setting: string | null
          budget_status: Database["public"]["Enums"]["budget_status_enum"]
          code: string
          created_at: string
          currency: string
          description: string | null
          end_date: string | null
          filming_locations: string | null
          fx_rate: number
          fx_rates: Json | null
          id: string
          line_producer: string | null
          name: string
          organization_id: string | null
          owner_id: string
          prep_days: number | null
          prepared_by: string | null
          producer: string | null
          production_company: string | null
          production_kind: string
          project_type: string
          shoot_days: number | null
          start_date: string | null
          status: string
          team_members: string[]
          updated_at: string
        }
        Insert: {
          base_currency?: string | null
          budget?: number
          budget_locked_at?: string | null
          budget_locked_by?: string | null
          budget_setting?: string | null
          budget_status?: Database["public"]["Enums"]["budget_status_enum"]
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          filming_locations?: string | null
          fx_rate?: number
          fx_rates?: Json | null
          id?: string
          line_producer?: string | null
          name: string
          organization_id?: string | null
          owner_id: string
          prep_days?: number | null
          prepared_by?: string | null
          producer?: string | null
          production_company?: string | null
          production_kind?: string
          project_type?: string
          shoot_days?: number | null
          start_date?: string | null
          status?: string
          team_members?: string[]
          updated_at?: string
        }
        Update: {
          base_currency?: string | null
          budget?: number
          budget_locked_at?: string | null
          budget_locked_by?: string | null
          budget_setting?: string | null
          budget_status?: Database["public"]["Enums"]["budget_status_enum"]
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          filming_locations?: string | null
          fx_rate?: number
          fx_rates?: Json | null
          id?: string
          line_producer?: string | null
          name?: string
          organization_id?: string | null
          owner_id?: string
          prep_days?: number | null
          prepared_by?: string | null
          producer?: string | null
          production_company?: string | null
          production_kind?: string
          project_type?: string
          shoot_days?: number | null
          start_date?: string | null
          status?: string
          team_members?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount: number
          budget_code: string | null
          created_at: string
          date: string | null
          description: string
          id: string
          linked_budget_line_id: string | null
          notes: string | null
          organization_id: string | null
          po_number: string
          project_id: string | null
          status: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          amount?: number
          budget_code?: string | null
          created_at?: string
          date?: string | null
          description?: string
          id?: string
          linked_budget_line_id?: string | null
          notes?: string | null
          organization_id?: string | null
          po_number: string
          project_id?: string | null
          status?: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          amount?: number
          budget_code?: string | null
          created_at?: string
          date?: string | null
          description?: string
          id?: string
          linked_budget_line_id?: string | null
          notes?: string | null
          organization_id?: string | null
          po_number?: string
          project_id?: string | null
          status?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_line_actuals"
            referencedColumns: ["line_id"]
          },
          {
            foreignKeyName: "purchase_orders_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_active_budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_linked_budget_line_id_fkey"
            columns: ["linked_budget_line_id"]
            isOneToOne: false
            referencedRelation: "v_budget_line_financials"
            referencedColumns: ["budget_line_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      rate_cards: {
        Row: {
          base_rate: number
          cadence: string
          created_at: string
          created_by: string | null
          crew_member_id: string | null
          currency: string
          effective_from: string | null
          effective_to: string | null
          housing_allowance: number
          id: string
          label: string
          notes: string | null
          organization_id: string | null
          overtime_rate: number
          per_diem: number
          person_id: string | null
          project_id: string | null
          transport_allowance: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_rate?: number
          cadence: string
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          effective_from?: string | null
          effective_to?: string | null
          housing_allowance?: number
          id?: string
          label: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          per_diem?: number
          person_id?: string | null
          project_id?: string | null
          transport_allowance?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_rate?: number
          cadence?: string
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          effective_from?: string | null
          effective_to?: string | null
          housing_allowance?: number
          id?: string
          label?: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          per_diem?: number
          person_id?: string | null
          project_id?: string | null
          transport_allowance?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_cards_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_cards_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_cards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_cards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          id: string
          module_key: string
          role_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module_key: string
          role_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_admin: boolean
          is_system: boolean
          layout_type: string
          name: string
          organization_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_admin?: boolean
          is_system?: boolean
          layout_type: string
          name: string
          organization_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_admin?: boolean
          is_system?: boolean
          layout_type?: string
          name?: string
          organization_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      series_episodes: {
        Row: {
          budget_allocation: number
          created_at: string
          created_by: string | null
          duration: number | null
          episode_number: number
          id: string
          organization_id: string | null
          project_id: string
          season_id: string
          shooting_date: string | null
          title: string
          updated_at: string
          updated_by: string | null
          variance_note: string | null
        }
        Insert: {
          budget_allocation?: number
          created_at?: string
          created_by?: string | null
          duration?: number | null
          episode_number: number
          id?: string
          organization_id?: string | null
          project_id: string
          season_id: string
          shooting_date?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          variance_note?: string | null
        }
        Update: {
          budget_allocation?: number
          created_at?: string
          created_by?: string | null
          duration?: number | null
          episode_number?: number
          id?: string
          organization_id?: string | null
          project_id?: string
          season_id?: string
          shooting_date?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          variance_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "series_episodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_episodes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "series_episodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "series_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      series_seasons: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          organization_id: string | null
          project_id: string
          season_number: number
          title: string
          updated_at: string
          updated_by: string | null
          variance_note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          project_id: string
          season_number: number
          title: string
          updated_at?: string
          updated_by?: string | null
          variance_note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id?: string | null
          project_id?: string
          season_number?: number
          title?: string
          updated_at?: string
          updated_by?: string | null
          variance_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "series_seasons_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_seasons_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_replied_at: string | null
          admin_replied_by: string | null
          admin_reply: string | null
          attachment_name: string | null
          attachment_path: string | null
          category: Database["public"]["Enums"]["support_ticket_category"]
          created_at: string
          description: string
          id: string
          priority: Database["public"]["Enums"]["support_ticket_priority"]
          status: Database["public"]["Enums"]["support_ticket_status"]
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_replied_at?: string | null
          admin_replied_by?: string | null
          admin_reply?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          category?: Database["public"]["Enums"]["support_ticket_category"]
          created_at?: string
          description: string
          id?: string
          priority?: Database["public"]["Enums"]["support_ticket_priority"]
          status?: Database["public"]["Enums"]["support_ticket_status"]
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_replied_at?: string | null
          admin_replied_by?: string | null
          admin_reply?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          category?: Database["public"]["Enums"]["support_ticket_category"]
          created_at?: string
          description?: string
          id?: string
          priority?: Database["public"]["Enums"]["support_ticket_priority"]
          status?: Database["public"]["Enums"]["support_ticket_status"]
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timeline_bars: {
        Row: {
          cash_alert: boolean
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          kind: string
          label: string
          metadata: Json
          organization_id: string | null
          project_id: string
          row_key: string
          start_date: string
          updated_at: string
          updated_by: string | null
          version_id: string
        }
        Insert: {
          cash_alert?: boolean
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          kind: string
          label: string
          metadata?: Json
          organization_id?: string | null
          project_id: string
          row_key: string
          start_date: string
          updated_at?: string
          updated_by?: string | null
          version_id: string
        }
        Update: {
          cash_alert?: boolean
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          kind?: string
          label?: string
          metadata?: Json
          organization_id?: string | null
          project_id?: string
          row_key?: string
          start_date?: string
          updated_at?: string
          updated_by?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_bars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_bars_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_bars_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timeline_bars_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "timeline_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_milestones: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          label: string
          metadata: Json
          milestone_date: string
          organization_id: string | null
          project_id: string
          row_key: string
          updated_at: string
          updated_by: string | null
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          label: string
          metadata?: Json
          milestone_date: string
          organization_id?: string | null
          project_id: string
          row_key: string
          updated_at?: string
          updated_by?: string | null
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          label?: string
          metadata?: Json
          milestone_date?: string
          organization_id?: string | null
          project_id?: string
          row_key?: string
          updated_at?: string
          updated_by?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_milestones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timeline_milestones_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "timeline_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      timeline_task_types: {
        Row: {
          category: string
          code: string
          color: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_hidden: boolean
          name: string
          organization_id: string | null
          overrides_code: string | null
          project_id: string | null
          required_count: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          code: string
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          name: string
          organization_id?: string | null
          overrides_code?: string | null
          project_id?: string | null
          required_count?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_hidden?: boolean
          name?: string
          organization_id?: string | null
          overrides_code?: string | null
          project_id?: string | null
          required_count?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_task_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_task_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_task_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      timeline_versions: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          organization_id: string | null
          project_id: string
          status: string
          updated_at: string
          updated_by: string | null
          version_date: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label: string
          organization_id?: string | null
          project_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_date?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string | null
          project_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timeline_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      timesheet_entries: {
        Row: {
          created_at: string
          hours: number
          id: string
          notes: string | null
          organization_id: string | null
          ot_hours: number
          project_id: string | null
          timesheet_id: string
          updated_at: string
          work_date: string
          worked: boolean
        }
        Insert: {
          created_at?: string
          hours?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          ot_hours?: number
          project_id?: string | null
          timesheet_id: string
          updated_at?: string
          work_date: string
          worked?: boolean
        }
        Update: {
          created_at?: string
          hours?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          ot_hours?: number
          project_id?: string | null
          timesheet_id?: string
          updated_at?: string
          work_date?: string
          worked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timesheet_entries_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_rate: number
          created_at: string
          created_by: string | null
          crew_member_id: string | null
          currency: string
          gross_amount: number
          id: string
          notes: string | null
          organization_id: string | null
          overtime_rate: number
          period_end: string
          period_start: string
          person_id: string | null
          project_id: string | null
          rate_card_id: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_rate?: number
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          gross_amount?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          period_end: string
          period_start: string
          person_id?: string | null
          project_id?: string | null
          rate_card_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_rate?: number
          created_at?: string
          created_by?: string | null
          crew_member_id?: string | null
          currency?: string
          gross_amount?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          overtime_rate?: number
          period_end?: string
          period_start?: string
          person_id?: string | null
          project_id?: string | null
          rate_card_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timesheets_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "rate_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          budget_code: string
          created_at: string
          created_by: string | null
          currency: string
          department: string | null
          description: string
          entity_id: string | null
          id: string
          is_film_commission_eligible: boolean
          metadata: Json
          notes: string | null
          organization_id: string | null
          payment_status: string
          project_id: string | null
          reference_no: string | null
          total_amount: number | null
          transaction_date: string
          transaction_type: string
          updated_at: string
          updated_by: string | null
          vat_amount: number
        }
        Insert: {
          amount?: number
          budget_code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          department?: string | null
          description: string
          entity_id?: string | null
          id?: string
          is_film_commission_eligible?: boolean
          metadata?: Json
          notes?: string | null
          organization_id?: string | null
          payment_status?: string
          project_id?: string | null
          reference_no?: string | null
          total_amount?: number | null
          transaction_date?: string
          transaction_type: string
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
        }
        Update: {
          amount?: number
          budget_code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          department?: string | null
          description?: string
          entity_id?: string | null
          id?: string
          is_film_commission_eligible?: boolean
          metadata?: Json
          notes?: string | null
          organization_id?: string | null
          payment_status?: string
          project_id?: string | null
          reference_no?: string | null
          total_amount?: number | null
          transaction_date?: string
          transaction_type?: string
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "master_budget"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_financial_ledger"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "v_financial_ledger"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      user_project_settings: {
        Row: {
          created_at: string
          currency: string
          default_unit: string
          project_name: string
          project_status: string
          project_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          default_unit?: string
          project_name?: string
          project_status?: string
          project_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          default_unit?: string
          project_name?: string
          project_status?: string
          project_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_rbac_settings: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          permissions: string[]
          role: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          permissions?: string[]
          role: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          permissions?: string[]
          role?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_rbac_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_role_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          organization_id: string | null
          project_id: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          organization_id?: string | null
          project_id?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          organization_id?: string | null
          project_id?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_role_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_categories: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          bank_country: string | null
          bank_name: string | null
          category: string | null
          company_nationality: string | null
          contact_name: string | null
          cr_no: string | null
          created_at: string
          email: string | null
          iban: string | null
          id: string
          is_auto_generated: boolean
          mobile: string | null
          name: string
          organization_id: string | null
          payment_terms: string | null
          position: string | null
          project_id: string | null
          shared_drive_url: string | null
          swift_code: string | null
          vat_no: string | null
          vendor_scope: string | null
        }
        Insert: {
          bank_country?: string | null
          bank_name?: string | null
          category?: string | null
          company_nationality?: string | null
          contact_name?: string | null
          cr_no?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          is_auto_generated?: boolean
          mobile?: string | null
          name: string
          organization_id?: string | null
          payment_terms?: string | null
          position?: string | null
          project_id?: string | null
          shared_drive_url?: string | null
          swift_code?: string | null
          vat_no?: string | null
          vendor_scope?: string | null
        }
        Update: {
          bank_country?: string | null
          bank_name?: string | null
          category?: string | null
          company_nationality?: string | null
          contact_name?: string | null
          cr_no?: string | null
          created_at?: string
          email?: string | null
          iban?: string | null
          id?: string
          is_auto_generated?: boolean
          mobile?: string | null
          name?: string
          organization_id?: string | null
          payment_terms?: string | null
          position?: string | null
          project_id?: string | null
          shared_drive_url?: string | null
          swift_code?: string | null
          vat_no?: string | null
          vendor_scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      verified_devices: {
        Row: {
          device_hash: string
          device_label: string | null
          id: string
          ip_address: string | null
          last_used_at: string
          user_id: string
          verified_at: string
        }
        Insert: {
          device_hash: string
          device_label?: string | null
          id?: string
          ip_address?: string | null
          last_used_at?: string
          user_id: string
          verified_at?: string
        }
        Update: {
          device_hash?: string
          device_label?: string | null
          id?: string
          ip_address?: string | null
          last_used_at?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      budget_line_actuals: {
        Row: {
          committed_amount: number | null
          line_id: string | null
          organization_id: string | null
          paid_amount: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_active_budget_lines: {
        Row: {
          amount: number | null
          character_id: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          excluded: boolean | null
          group: string | null
          header_code: string | null
          id: string | null
          main_code: string | null
          name: string | null
          notes: string | null
          organization_id: string | null
          prep: number | null
          project_id: string | null
          rate: number | null
          rebate_eligible: boolean | null
          shooting: number | null
          topsheet_code: string | null
          unit: string | null
          upload_batch_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          version_id: string | null
          wrap: number | null
          x: number | null
        }
        Insert: {
          amount?: number | null
          character_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          excluded?: boolean | null
          group?: string | null
          header_code?: string | null
          id?: string | null
          main_code?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          prep?: number | null
          project_id?: string | null
          rate?: number | null
          rebate_eligible?: boolean | null
          shooting?: number | null
          topsheet_code?: string | null
          unit?: string | null
          upload_batch_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version_id?: string | null
          wrap?: number | null
          x?: number | null
        }
        Update: {
          amount?: number | null
          character_id?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          excluded?: boolean | null
          group?: string | null
          header_code?: string | null
          id?: string | null
          main_code?: string | null
          name?: string | null
          notes?: string | null
          organization_id?: string | null
          prep?: number | null
          project_id?: string | null
          rate?: number | null
          rebate_eligible?: boolean | null
          shooting?: number | null
          topsheet_code?: string | null
          unit?: string | null
          upload_batch_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          version_id?: string | null
          wrap?: number | null
          x?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "budget_lines_topsheet_code_fkey"
            columns: ["topsheet_code"]
            isOneToOne: false
            referencedRelation: "budget_topsheet_accounts"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "budget_lines_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "budget_upload_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "budget_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      v_budget_code_position: {
        Row: {
          actual_sar: number | null
          available_sar: number | null
          budget_code: string | null
          budget_sar: number | null
          committed_sar: number | null
          line_count: number | null
          organization_id: string | null
          paid_sar: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_budget_line_financials: {
        Row: {
          actuals: number | null
          budget_code: string | null
          budget_line_id: string | null
          committed: number | null
          currency: string | null
          description: string | null
          estimate: number | null
          organization_id: string | null
          project_id: string | null
          variance: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_budget_vs_actual: {
        Row: {
          actual_amount: number | null
          budget_code: string | null
          category: string | null
          currency: string | null
          description: string | null
          group: string | null
          percent_used: number | null
          planned_amount: number | null
          variance: number | null
        }
        Insert: {
          actual_amount?: number | null
          budget_code?: string | null
          category?: string | null
          currency?: string | null
          description?: string | null
          group?: string | null
          percent_used?: never
          planned_amount?: number | null
          variance?: never
        }
        Update: {
          actual_amount?: number | null
          budget_code?: string | null
          category?: string | null
          currency?: string | null
          description?: string | null
          group?: string | null
          percent_used?: never
          planned_amount?: number | null
          variance?: never
        }
        Relationships: []
      }
      v_film_commission_report: {
        Row: {
          budget_code: string | null
          currency: string | null
          eligible_total: number | null
          net_amount: number | null
          total_vat: number | null
          transaction_count: number | null
          transaction_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "master_budget"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_financial_ledger"
            referencedColumns: ["budget_code"]
          },
        ]
      }
      v_financial_ledger: {
        Row: {
          actual_amount: number | null
          amount: number | null
          budget_category: string | null
          budget_code: string | null
          budget_description: string | null
          budget_group: string | null
          currency: string | null
          department: string | null
          description: string | null
          entity_id: string | null
          entity_name: string | null
          entity_position: string | null
          entity_type: string | null
          id: string | null
          is_film_commission_eligible: boolean | null
          payment_status: string | null
          planned_amount: number | null
          reference_no: string | null
          total_amount: number | null
          transaction_date: string | null
          transaction_type: string | null
          vat_amount: number | null
        }
        Relationships: []
      }
      v_ledger_transactions: {
        Row: {
          amount: number | null
          budget_code: string | null
          counterparty: string | null
          created_at: string | null
          currency: string | null
          department: string | null
          description: string | null
          entry_date: string | null
          entry_kind: string | null
          gl_account_id: string | null
          id: string | null
          organization_id: string | null
          project_id: string | null
          qfe_eligible: boolean | null
          reference: string | null
          source_id: string | null
          source_type: string | null
          status: string | null
          total: number | null
          vat_amount: number | null
          wht_amount: number | null
        }
        Relationships: []
      }
      v_overtime_by_code: {
        Row: {
          amount: number | null
          budget_code: string | null
          project_id: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overtime_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_paid_by_budget_code: {
        Row: {
          budget_code: string | null
          paid_sar: number | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_project_position"
            referencedColumns: ["project_id"]
          },
        ]
      }
      v_paid_by_code: {
        Row: {
          actuals: number | null
          budget_code: string | null
          project_id: string | null
        }
        Relationships: []
      }
      v_project_position: {
        Row: {
          actual_sar: number | null
          available_sar: number | null
          budget_sar: number | null
          committed_sar: number | null
          organization_id: string | null
          paid_sar: number | null
          project_id: string | null
          unallocated_actual_sar: number | null
          unallocated_committed_sar: number | null
          unallocated_paid_sar: number | null
          vat_sar: number | null
          wht_sar: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_source_totals_by_code: {
        Row: {
          budget_code: string | null
          project_id: string | null
          source_total: number | null
        }
        Relationships: []
      }
      v_vat_report: {
        Row: {
          budget_code: string | null
          currency: string | null
          gross_amount: number | null
          net_amount: number | null
          total_vat: number | null
          transaction_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "master_budget"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["budget_code"]
          },
          {
            foreignKeyName: "transactions_budget_code_fkey"
            columns: ["budget_code"]
            isOneToOne: false
            referencedRelation: "v_financial_ledger"
            referencedColumns: ["budget_code"]
          },
        ]
      }
    }
    Functions: {
      active_budget_version_id: { Args: { _project: string }; Returns: string }
      budget_line_total_sar: {
        Args: {
          p_amount: number
          p_currency: string
          p_excluded: boolean
          p_fx_rate: number
          p_prep: number
          p_rate: number
          p_shooting: number
          p_unit: string
          p_wrap: number
          p_x: number
        }
        Returns: number
      }
      can_access_contract_path: {
        Args: { _name: string; _uid: string }
        Returns: boolean
      }
      can_access_project: {
        Args: { _org: string; _proj: string; _uid: string }
        Returns: boolean
      }
      can_approve_payroll: {
        Args: { _org: string; _proj: string; _uid: string }
        Returns: boolean
      }
      can_create: { Args: { _module_key: string }; Returns: boolean }
      can_delete: { Args: { _module_key: string }; Returns: boolean }
      can_edit: { Args: { _module_key: string }; Returns: boolean }
      can_edit_timeline: {
        Args: { _proj: string; _uid: string }
        Returns: boolean
      }
      can_export: { Args: { _module_key: string }; Returns: boolean }
      can_view: { Args: { _module_key: string }; Returns: boolean }
      check_admin_unlock: {
        Args: { _email: string; _locked_until: string }
        Returns: boolean
      }
      contracts_path_org_id: { Args: { _name: string }; Returns: string }
      contracts_path_scope: {
        Args: { _name: string }
        Returns: {
          org_id: string
          project_id: string
        }[]
      }
      create_budget_draft: {
        Args: { _name?: string; _project: string }
        Returns: string
      }
      current_layout_type: { Args: never; Returns: string }
      current_role_id: { Args: never; Returns: string }
      get_active_project_fx_rate: {
        Args: {
          p_base_currency?: string
          p_project_id: string
          p_target_currency?: string
        }
        Returns: Json
      }
      get_budget_reconciliation: {
        Args: { _from?: string; _project: string; _to?: string }
        Returns: {
          actuals: number
          budget_code: string
          committed: number
          currency: string
          description: string
          in_master: boolean
          is_header: boolean
          master_actual: number
          master_planned: number
          parent_code: string
          project_estimate: number
          variance: number
        }[]
      }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          accepted: boolean
          email: string
          expires_at: string
          organization_name: string
          revoked: boolean
        }[]
      }
      get_my_permissions: {
        Args: { p_org_id?: string; p_project_id?: string }
        Returns: Json
      }
      get_project_budget_financials: {
        Args: { _project: string }
        Returns: {
          actuals: number
          budget_code: string
          budget_line_id: string
          committed: number
          currency: string
          description: string
          estimate: number
          variance: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin:
        | { Args: never; Returns: boolean }
        | {
            Args: { p_org_id: string; p_project_id?: string }
            Returns: boolean
          }
      is_budget_editable: { Args: { _proj: string }; Returns: boolean }
      is_company_admin_for_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_org_admin: { Args: { _org: string; _uid: string }; Returns: boolean }
      is_org_member: { Args: { _org: string; _uid: string }; Returns: boolean }
      is_org_member_for_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_org_owner: { Args: { _org: string; _uid: string }; Returns: boolean }
      is_project_admin: {
        Args: { _proj: string; _uid: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { _proj: string; _uid: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      log_auth_security_event: {
        Args: {
          p_attempt_count?: number
          p_email: string
          p_event_type: string
          p_lock_duration_minutes?: number
          p_user_agent?: string
        }
        Returns: undefined
      }
      master_budget_integrity: {
        Args: never
        Returns: {
          header_codes: number
          sub_codes: number
          total_codes: number
        }[]
      }
      publish_budget_version: { Args: { _version: string }; Returns: undefined }
      reverse_payroll_run: {
        Args: { _reason?: string; _run: string }
        Returns: Json
      }
      seed_demo_data: {
        Args: { _demo_user_id: string }
        Returns: {
          organization_id: string
          project_id: string
        }[]
      }
      submit_access_request: {
        Args: {
          p_company: string
          p_email: string
          p_full_name: string
          p_industry: string
          p_message?: string
          p_mobile: string
        }
        Returns: string
      }
      update_project_fx_rate: {
        Args: {
          p_base_currency?: string
          p_new_rate: number
          p_project_id: string
          p_reason?: string
          p_target_currency?: string
        }
        Returns: Json
      }
      user_has_permission: {
        Args: { _perm: string; _uid: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "manager" | "member"
      budget_macro_category: "ATL" | "BTL" | "Post" | "Other" | "Music" | "VFX"
      budget_status_enum:
        | "Draft"
        | "Pending Approval"
        | "Locked/Approved"
        | "Revision Requested"
      executive_title_enum:
        | "CEO"
        | "CFO"
        | "Executive Producer"
        | "Board Member"
      org_role: "owner" | "admin" | "member"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      support_ticket_category: "Bug" | "Financial" | "Access" | "Other"
      support_ticket_priority: "Normal" | "Urgent"
      support_ticket_status: "Open" | "In Progress" | "Closed"
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
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "manager", "member"],
      budget_macro_category: ["ATL", "BTL", "Post", "Other", "Music", "VFX"],
      budget_status_enum: [
        "Draft",
        "Pending Approval",
        "Locked/Approved",
        "Revision Requested",
      ],
      executive_title_enum: [
        "CEO",
        "CFO",
        "Executive Producer",
        "Board Member",
      ],
      org_role: ["owner", "admin", "member"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      support_ticket_category: ["Bug", "Financial", "Access", "Other"],
      support_ticket_priority: ["Normal", "Urgent"],
      support_ticket_status: ["Open", "In Progress", "Closed"],
    },
  },
} as const
