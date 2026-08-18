export type Category =
  | "code"
  | "audit"
  | "research"
  | "browser"
  | "text"
  | "config"
  | "planning"
  | "trivial"
  | "debugging"
  | "devops"
  | "database"
  | "config-ia"
  | "i18n";

export interface RuleMatrix {
  todo: boolean;
  pw: boolean;
  humanizer: boolean;
  codeReview: boolean;
  techDebt: boolean;
  inventory: boolean;
  memory: boolean;
  codeOrdering: boolean;
}

export const RULES_MATRIX: Record<Category, RuleMatrix> = {
  code: {
    todo: true,
    pw: false,
    humanizer: true,
    codeReview: true,
    techDebt: true,
    inventory: true,
    memory: true,
    codeOrdering: true,
  },
  audit: {
    todo: true,
    pw: false,
    humanizer: true,
    codeReview: true,
    techDebt: true,
    inventory: true,
    memory: true,
    codeOrdering: true,
  },
  research: {
    todo: false,
    pw: false,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: false,
    memory: false,
    codeOrdering: false,
  },
  browser: {
    todo: true,
    pw: true,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  text: {
    todo: true,
    pw: false,
    humanizer: true,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  config: {
    todo: true,
    pw: false,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  planning: {
    todo: true,
    pw: false,
    humanizer: true,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  trivial: {
    todo: false,
    pw: false,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: false,
    memory: false,
    codeOrdering: false,
  },
  debugging: {
    todo: true,
    pw: false,
    humanizer: false,
    codeReview: true,
    techDebt: true,
    inventory: true,
    memory: true,
    codeOrdering: true,
  },
  devops: {
    todo: true,
    pw: false,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  database: {
    todo: true,
    pw: false,
    humanizer: false,
    codeReview: true,
    techDebt: true,
    inventory: true,
    memory: true,
    codeOrdering: true,
  },
  "config-ia": {
    todo: true,
    pw: false,
    humanizer: false,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
  i18n: {
    todo: true,
    pw: false,
    humanizer: true,
    codeReview: false,
    techDebt: false,
    inventory: true,
    memory: true,
    codeOrdering: false,
  },
};

// FAST-TRACK categories: tasks so simple they bypass the gate entirely
export const FAST_TRACK_CATEGORIES: Category[] = ["trivial", "research"];

export const BLOCKED_TOOLS = [
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "run_command",
  "git_add",
  "git_commit",
  "git_push",
  "git_merge",
  "git_rebase",
  "git_cherry_pick",
  "git_reset",
  "git_clean",
  "git_stash",
  "git_init",
  "git_clone",
  "chrome-devtools_click",
  "chrome-devtools_type_text",
  "chrome-devtools_fill_form",
  "chrome-devtools_navigate_page",
  "obsidian_write_note",
  "obsidian_patch_note",
  "obsidian_move_note",
  "obsidian_delete_note",
  "obsidian_manage_tags",
  "obsidian_update_frontmatter",
  "cron_add_task",
  "cron_remove_task",
  "cron_update_task",
  "cron_enable_task",
  "cron_disable_task",
  "cron_run_task",
];
