# Meiou Taxes Redux

用于存放 MEIOU and Taxes v3.0 的独立 EU4 子模组。每个子模组有自己的目录和启动器描述符，不把上游模组文件纳入本仓库。

## 子模组

| 名称 | 用途 | 状态 |
| --- | --- | --- |
| `redux-tweak` | 数值调整与 MEIOU 建设体验修正 | 已加入属国省份选择、建设脚本修正，待游戏内验证 |

## redux-tweak

`redux-tweak.mod` 是启动器入口，`redux-tweak/descriptor.mod` 是模组目录内的描述符。两者声明依赖 `MEIOU and Taxes v3.0` 与 `Pop Display`，并沿用上游描述符中的 EU4 版本 `v1.37.*.*`。这里不使用 `replace_path`，避免遮蔽本体的整个目录。

在 Windows 上从仓库运行 `./Sync-ReduxTweak.ps1`，脚本默认同步到系统“文档”中的 EU4 `mod` 目录；也可以用 `-ModDirectory` 指定目标。脚本按已安装的 Pop Display GUI 生成本机适配的子模组覆盖文件，并校验安装底本的哈希；底本版本变化时需要先重新核对界面差异。同步完成后，在同一播放集内启用 MEIOU and Taxes v3.0、Pop Display 与 Redux Tweak。依赖声明负责确定 Redux 对前两者的覆盖优先级，不能只依据启动器显示顺序判断。

当前覆盖 `interface/provinceview.gui` 和 `common/scripted_effects/SYS-Construct.txt`：GUI 以 Pop Display 版本为底本，保留其省份界面控件，再在 DIP/MIL“钉选省份”按钮位置叠加仅适用于直属非朝贡属国省份的脚本按钮，并将其纳入父窗口的可点击范围；本国省份仍沿用原生按钮。`common/custom_gui/ReduxSubjectSelection.txt` 负责属国省份的选择切换，专用提示文字可用于辨别是否命中脚本按钮。建设脚本统一属国省份在计算与实际施工时的资格判断，并在没有可施工省份时阻止扣款。由于 EU4 对同路径文件采用覆盖方式，覆盖文件从 Pop Display 复制，功能差异保持最小。尚未加入数值平衡调整，按钮改动尚待重启游戏验证。

后续添加调整时，只把需要覆盖的游戏路径放入 `redux-tweak/`，记录所依据的上游文件与具体差异，再通过游戏验证效果。

### 批量选择属国

`0.1.1` 新增 `Bulk Selection: Include Subjects (OFF/ON)` 开关决议，默认关闭，状态按玩家国家保存。开启后，原有选择范围决议的相邻、Area、Region、正式州、全部领土和贸易节点模式会额外包含直属非朝贡属国的有效省份。关闭开关不清空已有选择，本国按钮的单省模式不扩展属国。

`0.1.2` 修正了属国按钮与范围决议的联动：开关关闭时属国选择按钮不可用，开启后可用。点击属国省份时，使用宗主国玩家的选择范围，而不是属国自己的范围；单省模式只切换当前省份，六种批量模式按当前起点扩展到本国和直属非朝贡属国。正式州模式选中时仅包含正式州核心，取消时沿用上游清除全部已选领土的逻辑。选择冻结时按钮和开关均不可用。

省份 GUI 布局、原生按钮和快捷键定义保持不变，属国脚本按钮改为调用玩家作用域的选择效果。`common/on_actions/00_on_actions.txt` 以当前安装的 MEIOU 文件为底本，只在两个原生选择回调中增加扩展调用；`common/scripted_effects/SYS-Prov.txt` 只在 `Pow_UI` 和 `Pow_UI_R` 中增加相同扩展入口。本国按钮继续执行原有逻辑，属国扩展使用相同选择范围和 `SYS_Pin.005/006` 显示路径。游戏内决议与批量操作仍待重启游戏验证。

## 构建与发布

仓库只保存源码、测试和构建脚本，`dist/` 中的压缩包不纳入 Git。旧提交历史中的压缩包保留，不重写历史。

| 分支或事件 | 行为 | 下载位置 |
| --- | --- | --- |
| 推送 `develop` | 按 mod 检查输入变化，构建 nightly | [Nightly Mods 工作流](https://github.com/YozoraTempest/Meiou-Taxes-Re-Dux/actions/workflows/nightly.yml) 的 Artifacts |
| 每日北京时间 02:00 | 检查 `develop`，补建变化、失败或过期的产物 | 同上 |
| `develop → main` PR | 校验合并结果和正式版本号，不重复生成开发包 | PR 检查报告 |
| PR 合并进 `main` | 从合入提交构建正式包并发布 | [Releases](https://github.com/YozoraTempest/Meiou-Taxes-Re-Dux/releases) |

nightly 名称为 `<mod-id>-nightly.zip`，保留 14 天；同一 mod 的构建输入不变、已有成功产物尚未过期时跳过重建。输入指纹包含源码、打包配置、共享构建脚本、声明的依赖及专属测试，不使用相邻两次推送的差异作为唯一依据。新的推送会取消未完成的旧 nightly 工作流，后续任务按输入指纹补建尚未成功的 mod。定时工作流定义需要存在于默认分支 `main`，任务实际检出 `develop`。GitHub 定时任务可能排队延迟，公开仓库连续 60 天无活动时会停用定时任务。

每个 mod 使用独立的正式标签，例如 `redux-tweak-v0.1.1`，附件为 `redux-tweak-0.1.1.zip`、SHA256 文件和构建元数据。下载模组附件，不使用 GitHub 自动生成的 Source code 压缩包。仓库全局的 Latest 标记不代表每个 mod 的最新版本，请按 mod 名称选择 Release。

正式包内容变化时，必须同时提高内外描述符中的版本号，PR 检查会阻止复用旧版本发布不同内容。首次正式发布可以使用当前版本。测试或工作流单独变化时会执行相关校验，但不重复发布内容未变化的正式包。直接推送 `main`、关闭未合并 PR、从其他分支合入 `main` 均不触发正式发布。已有正式 Release 不覆盖；失败后留下的草稿可在同一提交重试，文件上传完成后才公开。

### 本地验证

CI 全部使用 `.sh` 入口，不调用 PowerShell。需要 Node.js 26、POSIX shell 和 Python 3；Python 标准库负责 ZIP 格式与逐项字节校验，不需要安装第三方 Python 包。

```sh
sh ci/test.sh
sh ci/run.sh verify redux-tweak
sh ci/run.sh build nightly redux-tweak
sh ci/run.sh build release redux-tweak
```

产物位于 `dist/redux-tweak/`，玩家 ZIP 仅包含运行文件和许可证；校验和、构建元数据存放在 ZIP 外部。重复执行本地构建前需移走同名旧产物，打包器不会覆盖已有 ZIP。

### 添加其他 mod

在根目录添加 `<mod-id>/` 和 `<mod-id>.mod`，内外描述符版本及内容保持一致，启动器路径为 `mod/<mod-id>`。然后在 `ci/mods.json` 中注册唯一 ID、名称、完整运行文件白名单、测试输入及测试命令；确实依赖仓库内其他 mod 时才填写 `depends_on`。未登记的运行文件会导致打包校验失败。

新增 mod 不需要复制工作流。修改单个 mod 或其测试只影响该 mod 及声明的依赖方；共享构建输入影响引用方。修改 README 或本机同步脚本不生成新玩家包。调整某个 mod 的配置不会改变其他 mod 的输入指纹。

建议将 `main` 设置为必须通过 PR 合入，并要求 `Release Checks` 检查通过。
