# 私有GitHub回滚备份回执

- 目标仓库：https://github.com/Biu-nan/yikuaborder-private-backup 。创建后及推送后均回读确认private=true。
- 固定备份分支：backup/pre-upgrade-20261024。
- 固定回滚标签：pre-upgrade-20261024。
- 回滚提交：373dbcb48cb4be7185349448c696161b2d9eea85。
- GitHub API回读分支与标签解引用均等于上述提交；本地bundle包含完整历史并通过git bundle verify。
- 原公开origin未推送本次备份或升级；新增private-backup远程用于本次私有交付。
- 本文补充并更正升级前快照说明中最初拟使用origin的目的地；标签与快照提交保持固定，不追改历史。

后续升级使用独立upgrade/reliability-20261024分支。代码回滚不能撤销已发生的店小秘操作或恢复迁移后的业务数据；数据迁移前仍需一致性备份。
