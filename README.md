# ListenToYourWife Web POC
当前 POC 先打通两个核心点：
1. 在科大讯飞注册目标说话人的声纹（feature_id）
2. 提供后续「混合音频 -> 识别老婆说话 -> 转写 -> 生成计划」的后端接口骨架

## 快速启动
1. 安装依赖
```bash
npm install
```
2. 配置环境变量
- 编辑 `.env`，填入：
  - `IFLYTEK_APP_ID`
  - `IFLYTEK_ACCESS_KEY_ID`
  - `IFLYTEK_ACCESS_KEY_SECRET`
3. 启动
```bash
npm run dev
```
4. 打开浏览器访问
- `http://localhost:8787`

## 为什么声纹注册是必须步骤
如果目标是“从多人语音中识别你老婆说的话”，系统必须先知道“你老婆的声纹特征是什么”，即要先拿到 `feature_id`。
没有这个步骤，最多只能做盲分说话人（speaker 1 / speaker 2），无法知道哪个是你老婆。

## 当前状态
- ✅ `/api/voiceprint/register` 已实现
- ✅ Web 页面可上传音频并注册声纹
- 🚧 `/api/audio/process` 目前是占位（下一步接入分离、匹配、转写和任务提取）

## 下一步建议
1. 增加“声纹比对/检索”接口（对分段后的语音做老婆匹配）
2. 接入 ASR（科大讯飞转写大模型或 MiniMax）
3. 做任务抽取（时间、地点、待办）和日历写入
4. 增加账号体系与数据存储，便于迁移 iOS/Android 共用后端 API
# listentoyourwife
