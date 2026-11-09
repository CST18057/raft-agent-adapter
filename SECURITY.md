# Security reporting / 安全反馈

This experimental adapter launches the installed Devin CLI with the current user's permissions. Devin retains its own account, tool-permission, and session behavior. The adapter is not an execution sandbox. Only use reviewed checkouts and trusted executable paths.

Local configuration, proxy credentials, account files, transcripts, and installation-state backups must not be shared in public issues. The PATH backup may contain personal directory names. `.gitignore` helps prevent accidental commits but is not a substitute for reviewing staged content.

For a security issue, use GitHub's **Security → Report a vulnerability** if private reporting is available for this repository. Otherwise open a minimal issue asking for a private reporting channel, without exploit details or sensitive data. No response-time guarantee is offered.

安全问题请优先通过仓库 Security 页的私密漏洞报告功能反馈；若该功能不可用，请只提交请求私下沟通的最小 Issue，不公开漏洞细节或敏感数据。请勿上传账户文件、代理密码、完整会话或环境变量。

Only the latest release is currently maintained. There is no guaranteed compatibility or security support period.
