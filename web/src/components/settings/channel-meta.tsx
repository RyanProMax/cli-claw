export const CHANNEL_LABEL: Record<string, string> = {
  feishu: '飞书',
  wechat: '微信',
};

export const CHANNEL_COLORS: Record<string, string> = {
  feishu: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  wechat: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
};

const FeishuIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
    <path d="M3.75 2.813c1.57 1.968 2.457 4.406 2.504 6.906L12 4.5l-3.75 9.375s-.117 3.281 3.281 6.563c0 0-6.093 1.171-9.14-2.11C-.843 14.83.375 7.688 3.75 2.812z" />
    <path d="M20.86 8.72a6.745 6.745 0 0 0-4.235-1.47c-1.406 0-2.672.422-3.75 1.125l-1.406 6.188 1.406 1.124c1.313 1.032 3.282 1.969 5.86 1.969 0 0-.563-3.282.937-5.625.844-1.313 1.266-2.266 1.188-3.313z" />
  </svg>
);

const WeChatIcon = () => (
  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
    <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991a.96.96 0 0 1 0 1.92.96.96 0 0 1 0-1.92zm5.812 0a.96.96 0 0 1 0 1.92.96.96 0 0 1 0-1.92zm3.2 4.218c-3.79 0-6.873 2.594-6.873 5.803 0 3.208 3.084 5.803 6.874 5.803a8.3 8.3 0 0 0 2.346-.339.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.045c.133 0 .241-.108.241-.241 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C21.052 18.636 22 16.96 22 15.012c0-3.21-3.084-5.803-6.874-5.803h-.33zm-2.155 2.928a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6zm4.298 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z" />
  </svg>
);

export const CHANNEL_ICON: Record<string, React.FC> = {
  feishu: FeishuIcon,
  wechat: WeChatIcon,
};

/** Render a channel badge with icon + label */
export function ChannelBadge({ channelType }: { channelType: string }) {
  const Icon = CHANNEL_ICON[channelType];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5 ${CHANNEL_COLORS[channelType] || 'bg-muted text-muted-foreground'}`}>
      {Icon && <Icon />}
      {CHANNEL_LABEL[channelType] || channelType}
    </span>
  );
}
