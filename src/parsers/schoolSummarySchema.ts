// src/parsers/schoolSummarySchema.ts

/**
 * JSON Schema for OpenAI Structured Outputs
 * Ensures AI returns valid SchoolSummary format with proper types
 *
 * Schema follows OpenAI's requirements:
 * - additionalProperties: false (strict mode)
 * - All fields required or have defaults
 * - No nullable types (use empty arrays/strings instead)
 */
export const schoolSummarySchema = {
  type: "object",
  properties: {
    email_analysis: {
      type: "object",
      properties: {
        total_received: {
          type: "number",
          description: "Total number of emails received (must match input count)"
        },
        signal_count: {
          type: "number",
          description: "Number of school-related emails (signal)"
        },
        noise_count: {
          type: "number",
          description: "Number of non-school emails (noise)"
        },
        noise_examples: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Array of noise email subjects (up to 5 examples)"
        }
      },
      required: ["total_received", "signal_count", "noise_count", "noise_examples"],
      additionalProperties: false
    },
    summary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          child: {
            type: "string",
            description: "Child's name from email, or 'General' if not mentioned"
          },
          icon: {
            type: "string",
            description: "Emoji icon representing the item"
          },
          text: {
            type: "string",
            description: "Summary text of what needs attention"
          }
        },
        required: ["child", "icon", "text"],
        additionalProperties: false
      },
      description: "Array of summary items requiring attention"
    },
    kit_list: {
      type: "object",
      properties: {
        tomorrow: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: {
                type: "string",
                description: "Kit item needed (e.g., 'PE kit')"
              },
              context: {
                type: "string",
                description: "Context for the item (e.g., '[Child] - outdoor PE')"
              }
            },
            required: ["item", "context"],
            additionalProperties: false
          },
          description: "Kit items needed tomorrow"
        },
        upcoming: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: {
                type: "string",
                description: "Kit item needed"
              },
              day: {
                type: "string",
                description: "Day when item is needed (e.g., 'Thursday')"
              }
            },
            required: ["item", "day"],
            additionalProperties: false
          },
          description: "Kit items needed in upcoming days"
        }
      },
      required: ["tomorrow", "upcoming"],
      additionalProperties: false
    },
    financials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Description of the payment"
          },
          amount: {
            type: "string",
            description: "Payment amount (e.g., '£15.00')"
          },
          deadline: {
            type: "string",
            description: "Payment deadline in ISO8601 format (REQUIRED - exclude item if no deadline)",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$"
          },
          url: {
            type: "string",
            description: "Payment URL or 'manual_check_required'"
          },
          payment_method: {
            type: "string",
            description: "Payment method (e.g., 'Arbor Pay', 'ParentPay', 'Check email for details')"
          }
        },
        required: ["description", "amount", "deadline", "url", "payment_method"],
        additionalProperties: false
      },
      description: "Financial items requiring payment"
    },
    attachments_requiring_review: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "Email subject"
          },
          from: {
            type: "string",
            description: "Sender name"
          },
          reason: {
            type: "string",
            description: "Specific reason why review is needed (e.g., 'Permission form requires signature')"
          }
        },
        required: ["subject", "from", "reason"],
        additionalProperties: false
      },
      description: "Attachments that require parent review or action"
    },
    calendar_updates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event: {
            type: "string",
            description: "Event name or description"
          },
          date: {
            type: "string",
            description: "Event date in ISO8601 format",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$"
          },
          action: {
            type: "string",
            description: "Action taken (e.g., 'added' or 'updated')"
          }
        },
        required: ["event", "date", "action"],
        additionalProperties: false
      },
      description: "Calendar events to add or update"
    },
    recurring_activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "Activity description (e.g., 'PE', 'Swimming club')"
          },
          child: {
            type: "string",
            description: "Child's name"
          },
          days_of_week: {
            type: "array",
            items: {
              type: "number",
              minimum: 1,
              maximum: 7
            },
            description: "Days of week (1=Monday, 2=Tuesday, ..., 7=Sunday)"
          },
          frequency: {
            type: "string",
            description: "Frequency (currently only 'weekly' supported)"
          },
          requires_kit: {
            type: "boolean",
            description: "Whether kit or equipment is required"
          },
          kit_items: {
            type: "array",
            items: {
              type: "string"
            },
            description: "List of required kit items (empty array if not mentioned)"
          }
        },
        required: ["description", "child", "days_of_week", "frequency", "requires_kit", "kit_items"],
        additionalProperties: false
      },
      description: "Recurring activities detected from emails (e.g., 'PE on Mondays and Tuesdays')"
    },
    pro_dad_insight: {
      type: "string",
      description: "One actionable insight or tip for the day"
    }
  },
  required: [
    "email_analysis",
    "summary",
    "kit_list",
    "financials",
    "attachments_requiring_review",
    "calendar_updates",
    "recurring_activities",
    "pro_dad_insight"
  ],
  additionalProperties: false
} as const;
