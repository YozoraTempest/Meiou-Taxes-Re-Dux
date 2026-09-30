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

`0.1.1` 新增 `Bulk Selection: Include Subjects (OFF/ON)` 开关决议，默认关闭，状态按玩家国家保存。开启后，原有选择范围决议的相邻、Area、Region、正式州、全部领土和贸易节点模式会额外包含直属非朝贡属国的有效省份；取消批量选择使用相同范围。关闭开关不清空已有选择，单省模式不扩展属国。

此功能不修改省份 GUI、按钮或快捷键定义。`common/on_actions/00_on_actions.txt` 以当前安装的 MEIOU 文件为底本，只在两个原生选择回调中增加扩展调用；`common/scripted_effects/SYS-Prov.txt` 只在 `Pow_UI` 和 `Pow_UI_R` 中增加相同扩展入口。其他原有代码保持不变。游戏内决议与批量操作仍待重启游戏验证。
