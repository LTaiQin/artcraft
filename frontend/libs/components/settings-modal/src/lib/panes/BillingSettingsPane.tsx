export const BillingSettingsPane = () => (
  <div className="flex flex-col gap-3 pt-3 text-base-fg">
    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Personal API billing</p>
    <p className="text-sm leading-relaxed text-base-fg/70">生成费用由你在 Personal APIs 中配置的服务商收取，请在服务商控制台查看额度与账单。ArtCraft 账号、订阅和平台积分已移除。</p>
    <p className="text-sm leading-relaxed text-base-fg/70">请求超时后请先核对服务商记录。视频任务已保存云端任务 ID，应用重启后继续查询，不会再次提交生成请求。</p>
  </div>
);
