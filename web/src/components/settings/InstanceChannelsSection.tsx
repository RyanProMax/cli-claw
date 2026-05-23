import { FeishuChannelCard } from './FeishuChannelCard';
import { WeChatChannelCard } from './WeChatChannelCard';

export function InstanceChannelsSection() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground bg-muted rounded-lg px-4 py-3">
        配置实例级 IM 通道。消息默认进入主工作区，也可以在 IM 绑定里改到指定工作区或会话。
      </p>
      <FeishuChannelCard />
      <WeChatChannelCard />
    </div>
  );
}
