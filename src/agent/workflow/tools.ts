export const DEFAULT_WORKFLOW_KNOWN_TOOLS = [
  'send_message',
  'send_image',
  'send_file',
  'schedule_task',
  'list_tasks',
  'pause_task',
  'resume_task',
  'cancel_task',
  'register_group',
] as const;

export const DEFAULT_WORKFLOW_LOCAL_TASK_IDS = [
  'stock.hkipo.fetch_pool',
  'stock.hkipo.scan_heat',
  'stock.hkipo.fetch_official_docs',
  'stock.hkipo.run_backtest',
] as const;
