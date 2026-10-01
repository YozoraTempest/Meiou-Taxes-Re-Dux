# Meiou Taxes Redux

用于存放 MEIOU and Taxes v3.0 的独立 EU4 子模组。每个子模组有自己的目录和启动器描述符，不把上游模组文件纳入本仓库。

## 子模组

| 名称 | 用途 | 状态 |
| --- | --- | --- |
| `redux-tweak` | 数值调整与基础设施施工并发修正 | `0.1.4`，空闲施工槽自动承接排队单位 |
| `redux-subject` | 属国管理：省份选择、批量选择范围与建设修正 | `0.1.3`，独立选择按钮使用完整图案并直接更新地图图钉 |
| `redux-test` | 用决议和事件在游戏内验证施工并发 | `0.1.0`，五种场景、状态报告与补槽核验 |

## redux-tweak

`redux-tweak.mod` 与 `redux-tweak/descriptor.mod` 只依赖 `MEIOU and Taxes v3.0`，支持 EU4 `v1.37.*.*`。施工修正使用独立的效果、隐藏事件与追加式 `on_actions` 文件，沿用 MT 的十个省份施工槽。

### 施工并发

MT 在开工时把多个单位分配到当时可用的施工槽。其他工程结束后，这些队列原本不会使用释放的槽位，因此请求并发 10 的工程可能一直只用两个槽完成整批工程。Redux Tweak 在每年二月由 MT 控制国家 `AAA` 的月度钩子执行一次补槽，避开单人及多人模式的一月年度结算，并跳过开局人口模拟。

补槽只转移尚未开工的排队单位。当前单位的剩余资源、劳动需求和已计支出保持原值；新槽复制建筑类型、出资方和请求并发，并通过 MT 的 `Infra_StartProjectHelper` 初始化下一单位。随后抵消助手新增的 `Infra_InConst` 数量，保持原订单的待建总量与资金不变。本机 MT 版本中，助手也会同步更新各类基础设施的实际并发显示。下一次年度结算通过 MT 原流程计入新槽的需求、支出和进度。

队列按槽位保存的建筑类型、出资方和请求并发分组。分组的活动槽数达到请求上限后停止补槽，所有建筑类型仍共享每省最多十个槽。不同类型、不同出资方或不同请求并发分别计算；原来请求并发 2 的阶级工程不会被改成并发 10。空槽不足时按原槽位编号依次处理，二月之后释放的槽位在下一年二月处理。

现有存档没有订单批次 ID。同一类型、同一出资方、同一请求并发的多次下单按一个组保守计算上限，可能少于每笔订单各自上限之和。修正沿用 MT `Infra_RunScript` 已支持的基础设施 ID 8–14；不重写其产业投资或 ID 1–7 的处理规则，也不添加存档迁移。

`verification/redux-tweak/VERIFY.mjs` 解释实际交付脚本及两套 MT 施工效果样本，检查总量守恒、已有进度、出资方、并发上限、显示统计、年度完成与二月触发条件。样本不进入玩家包。这些检查不替代 EU4 内运行验证；安装后需重启游戏并启用 Redux Tweak，在二月后观察被限制的排队工程。可在非铁人测试存档中使用 `event ReduxConstruction.1 AAA` 手动触发一次补槽。

省份界面、选择决议和属国建设修正均归 Redux Subject。数值调整继续放在 Redux Tweak 中。

## redux-subject

Redux Subject 用于属国管理，当前内容包括属国省份选择、批量选择开关和建设修正。省份界面中的脚本化按钮是这些管理功能的操作入口。

`redux-subject.mod` 与 `redux-subject/descriptor.mod` 声明依赖 `MEIOU and Taxes v3.0` 和 `Pop Display`，版本沿用上游 EU4 `v1.37.*.*`。省份界面以 Pop Display 的 `provinceview.gui` 为底本，保留其余控件与非 UTF-8 字节。两个 mod 均不使用 `replace_path`，彼此没有依赖。启用 Redux Subject 及其上游依赖即可使用当前功能。

### 省份选择

保留 MT 原生 `prod_base_increase_button` 和 `mp_base_increase_button` 的名称、位置、快捷键及发展度回调。在原选择列上方新增一个 `redux_subject_select` 脚本化按钮，位置为 `x = 490, y = 65`，使用上游完整的 55 × 55 选择按钮图案；按钮下沿为 `y = 120`，与 `y = 125` 的原有文字留出 5 个界面单位的间距。新增按钮位于 `province_window` 的直接子层，本国和直属属国共用同一处理器。该按钮通过鼠标点击使用，不分配快捷键；原有 `d` 快捷键沿用 MT/Pop Display 的原逻辑。

选择范围仍由 MT 的原有决议设置。按钮直接通过 `FROM` 读取玩家的 `UI_SelectScope`，不读取属国自己的范围，也不创建 `Redux_SelectionActor` 保存目标。单省模式只切换当前省份，批量模式覆盖相邻、Area、Region、正式州、全部领土和贸易节点。正式州选中只处理正式州核心；取消沿用 MT 清除已选领土的逻辑。每个省份更新 `UI_Select` 时直接调用 MT 的 `POP_ChangePin`，按该省份的 `ID_Prov` 显示或隐藏红色图钉，同时清除该省的 `Pin_Show/Pin_Hide` 待处理标记。新增按钮不再依赖 `SYS_Pin.005/006` 事件完成显示，原 MT/Pop Display 入口继续沿用其事件逻辑。

`Bulk Selection: Include Subjects (OFF/ON)` 决议迁移到 Redux Subject，保留原来的决议 ID 和 `Redux_IncludeSubjects` 国家标志，已有存档状态不变。关闭时新增按钮仍可选择本国省份，选择属国省份需要开启；开启后六种批量范围可包含直属属国。切换开关不清空已有选择。`UI_Freeze` 建设冻结期间新增按钮和决议不可用。原发展度选择按钮和 Pop Display 的其他快捷选择控件保留其原有处理逻辑。

属国资格使用 MT 的 `is_subject_other_than_tributary_trigger` 与 `is_subject_of = FROM`，覆盖分封附庸、分权和叛乱分权附庸、军阀、委任领、名义附庸、各类联合统治、殖民领及其他扩展类型。按 MT 当前定义排除 `tributary_state` 与 `close_tributary_state`；`muscovite_tributary_state` 沿用 MT 原条件，仍可选择。该条件按直属关系识别属国，间接属国与其他国家的属国不在选择范围内。验证样本包含本机 MT 声明的 28 种类型，样本放在 `verification/`，不进入玩家包。

### 属国建设

`common/scripted_effects/SYS-Construct.txt` 已从 Redux Tweak 原样迁入 Redux Subject。该效果统一了属国省份在费用计算与实际施工时的资格判断，并在没有可施工省份时阻止扣款。Pop Display 的建设事件调用此效果；本机 MT 普通建设事件使用已展开的脚本，仍需另行统一其施工条件和建设主体。

Redux Subject 不覆盖 MT 的 `00_on_actions.txt` 或 `SYS-Prov.txt`。脚本与 GUI 结构已做本地检查，实际点击、快捷键、钉选渲染和施工状态仍需重启游戏验证。

### 同步与升级

使用 POSIX shell 和 Node.js，同步入口不需要 PowerShell：

```sh
sh Sync-ReduxMods.sh "C:/Users/Vulon/OneDrive/文档/Paradox Interactive/Europa Universalis IV/mod"
```

默认同步登记的三个 mod；也可在目录参数后指定 `redux-tweak`、`redux-subject` 或 `redux-test`。脚本直接覆盖目标运行文件，更新启动器描述符路径，并移除旧 Tweak 中十个已迁出的 UI 与建设文件。同步 Redux Subject 时也会移除旧 `redux-ui.mod` 和已知 Redux UI 运行文件。同步只复制和清理文件，不创建备份、同步记录或临时副本，也不校验目标文件的历史哈希。

原有 `Sync-ReduxTweak.ps1` 仅保留为已经使用过的同步入口，内部转交同一个 shell/Node 实现。新文档与 CI 均使用 `.sh`。脚本不修改播放集，需要在启动器中启用所需 mod。直接从玩家 ZIP 升级时，移除旧 `redux-ui.mod` 和 `redux-ui/`，完整替换旧 `redux-tweak/` 目录，再解压所需新包。更名保留 `Redux_IncludeSubjects` 标志和原有决议 ID，存档中的属国选择开关继续沿用。

## redux-test

Redux Test 是独立的游戏内测试工具，依赖 `MEIOU and Taxes v3.0` 与 `Redux Tweak`，没有 `replace_path` 或自动运行钩子。它使用人类玩家决议触发省份事件，事件中的确认选项执行测试。测试界面采用英文语言槽中的中文本地化，并预先转换为本机 MT 汉化及 EU4 双字节补丁使用的转义编码。正常游玩时可在启动器中关闭 Redux Test。

中文原文保存在 `localisation-src/redux-test_l_english.yml`。修改原文后运行 `node ci/localisation.mjs redux-test`，生成玩家目录中的本地化文件；不要直接编辑生成文件。生成器使用固定版本的 MIT 开源 EU4SpecialEscape 编码函数，保留 UTF-8 BOM、颜色标记、变量引用与换行；保留字节表与 EU4dll 对齐，避免「工」等汉字转码后带出 `]` 并被引擎当作变量语法。CI 检查生成文件与原文一致，按 CP1252 字节位置解码验证所有中文能够还原，并检查方括号引用与颜色标记完整。原文及编码工具不进入玩家包。

启用 Redux Tweak 与 Redux Test，重启游戏并载入专门的测试存档。待开局人口模拟结束后，使用 MT 的省份选择功能恰好选中一个本国有效省份，确认该省没有任何在建工程，再打开决议。新场景要求本国没有其他标记的测试省份；确认时会再次检查条件。省份选择可以使用 MT 原入口，也可使用 Redux Subject 的选择按钮，Redux Test 不依赖 Redux Subject。

| 测试决议 | 初始工程 | 预期行为 |
| --- | --- | --- |
| `01：10 单位订单被限制为 2 个槽` | 四笔阶级道路订单占 8 槽，玩家 10 单位设施请求并发 10，只得到 2 槽 | 释放占位工程后仍为 2；执行补槽后变成 10，待建总量保持 10 |
| `02：同建筑类型、不同出资方` | 阶级设施 2 单位、玩家设施 10 单位 | 共用 10 槽，分别占 2 与 8；阶级上限保持 2 |
| `03：不同建筑类型共用施工槽` | 阶级道路 2 单位、玩家设施 10 单位 | 共用 10 槽，分别占 2 与 8，类型与出资方保留 |
| `04：真实并发 2 的对照组` | 玩家设施 10 单位，保存的请求并发为 2 | 补槽仍为 2；每次满供给施工检查完成 2 单位 |
| `05：先建阶级并发 2，再手动追加` | 只建立阶级道路 2 单位 | 使用原建设窗口手动追加一笔 10 单位基础设施，再查看请求并发与实际槽数 |

场景 01 的即时验证顺序为：保持暂停 → 确认建立场景 →「释放占位工程」→「执行补槽并核验」。结果事件检查真实活动槽、全部待建单位与各类 `Infra_InConst` 数量、原活动槽的建筑类型/出资方/请求并发/支出/八种剩余资源，以及相关省份资金。已有玩家单位设置为半程，用于验证补槽没有重置其进度；所有订单与资源成本通过 MT 原施工入口建立，没有复制 Redux Tweak 的补槽实现。

「查看施工状态」显示窗口请求并发、参考订单保存的请求并发、活动槽数和待建单位。窗口选择按 MT 内部值加 1。当前报告把公共基础设施资金池（出资方 0）的项目归入「玩家」栏；MT 的地方阶级自动建设也使用该资金池，因此该栏不能用于识别真实下单来源。类型与请求并发取第一个符合条件的槽，活动槽和待建数量则汇总该资金池全部基础设施项目。核验针对单一类型与请求并发分组，多笔混合订单会报告槽位分组失败，此时不要把参考订单的预期槽数理解为所有项目的上限。产业投资的出资方 7 与 ID 1–7 不属于此次补槽修正范围。单独只有阶级占 2 槽时，玩家请求 10 槽通常分配到 8 槽；场景 01 的八个占位槽用于稳定构造最初只能分配 2 槽的情形。

观察自然年度结算时，应同时检查已建成数量和当前槽的开工日期。MT 的地方阶级自动建设每笔通常为 2 单位、请求并发 2；有空槽且建设条件满足时，可以在旧项目尚未完成时追加订单，也可以在完工后重新占用刚释放的槽。因此「在建 2」长期不变、劳动需求下降后重新升高可能表示旧项目已完成并开始了新的一批。自动新建先于二月补槽，可能使已有排队工程继续受限于剩余槽位。

「满供给推进一次施工检查」临时将材料和劳动供给率设为 100%，对每个槽运行一次 MT 的 `Infra_CheckProject` 后恢复原值。场景 01 补槽到 10 后应完成 10 单位，对照组应完成 2 单位。此操作实际增加建成单位，用于检查施工完成量；它不模拟年度采购、劳动来源与付款。检验自然结算时应推进游戏到下一次一月并观察供给和支出。

「触发 Tweak 实际补槽事件」经确认后对 `AAA` 调用 `ReduxConstruction.1`，作用于全部有效省份，推进一天后回报测试省份状态。检验追加式月度钩子时，重新建立场景 01、释放占位工程后不手动补槽，自然推进到二月，再查看状态。这样可以分别检查效果调用、事件入口和月度钩子。

「清理剩余测试工程」只处理标记省份，取消该省尚未完成的基础设施队列并更新 MT 统计。它借助 MT 完工流程清槽，随后抵消该过程临时增加的建成单位；此前实际完成的单位和已支付费用保留。产业项目 ID 1–7 保留，若仍有项目则保留标记并报告未清理完毕。测试期间不要在该省建立无关订单。测试场景会改变游戏状态，清理不是存档回滚。

同步测试工具和被测模组：

```sh
sh Sync-ReduxMods.sh "C:/Users/Vulon/OneDrive/文档/Paradox Interactive/Europa Universalis IV/mod" redux-tweak redux-test
```

测试场景、决议/事件入口、失败分支、月度触发、满供给完工与清理通过 `verification/redux-test/VERIFY.mjs` 对两套 MT 效果样本解释执行。解释器和样本不进入玩家包，游戏加载、事件窗口及自然经济结算仍需 EU4 内验证。

## 构建与发布

仓库只保存源码、测试和构建脚本，`dist/` 中的压缩包不纳入 Git。旧提交历史中的压缩包保留，不重写历史。

| 分支或事件 | 行为 | 下载位置 |
| --- | --- | --- |
| 推送 `develop` | 按 mod 检查输入变化，构建并更新滚动 Nightly Release | [Redux Tweak Nightly](https://github.com/YozoraTempest/MnT-Re-Dux/releases/tag/redux-tweak-nightly)、[Redux Subject Nightly](https://github.com/YozoraTempest/MnT-Re-Dux/releases/tag/redux-subject-nightly) |
| 每日北京时间 02:00 | 检查 `develop`，补建变化、缺失或发布未完成的产物 | 同上 |
| `develop → main` PR | 校验合并结果和正式版本号，不重复生成开发包 | PR 检查报告 |
| PR 合并进 `main` | 从合入提交构建正式包并发布 | [Releases](https://github.com/YozoraTempest/MnT-Re-Dux/releases) |

每个 mod 使用固定的 `<mod-id>-nightly` 标签和同一个 Nightly Release，标记为预发布版本。构建成功后覆盖 `<mod-id>-nightly.zip`、其 SHA256 文件和 `<mod-id>-build-info.json`，把标签移到本次构建提交，并更新发布说明中的版本、提交和构建时间。固定标签与附件名称保持下载链接稳定；不累积每次构建的 Release，也不占用正式版的 Latest 标记。

只有已公开的 Nightly Release 与当前输入指纹一致、三个附件的 GitHub SHA256 摘要匹配、标签指向构建信息记录的提交时才跳过重建。ZIP 与校验和先上传并核对，构建信息最后上传；首次发布的附件完整前保持草稿。构建或发布失败、附件缺失、标签不一致时，后续任务会重新构建并补齐同一个 Release。Actions Artifacts 仍保留 14 天用于检查；过期不影响 Release 下载，也不触发内容不变的重新发布。

输入指纹包含源码、打包配置、共享构建脚本、声明的依赖及专属测试，不使用相邻两次推送的差异作为唯一依据。新的推送会取消未完成的旧 nightly 工作流，后续任务按 Release 状态补建尚未完整发布的 mod。定时工作流定义需要存在于默认分支 `main`，任务实际检出 `develop`。GitHub 定时任务可能排队延迟，公开仓库连续 60 天无活动时会停用定时任务。

每个 mod 使用独立的正式标签，例如 `redux-tweak-v0.1.1`，附件为 `redux-tweak-0.1.1.zip`、SHA256 文件和构建元数据。下载模组附件，不使用 GitHub 自动生成的 Source code 压缩包。仓库全局的 Latest 标记不代表每个 mod 的最新版本，请按 mod 名称选择 Release。

正式包内容变化时，必须同时提高内外描述符中的版本号，PR 检查会阻止复用旧版本发布不同内容。首次正式发布可以使用当前版本。测试或工作流单独变化时会执行相关校验，但不重复发布内容未变化的正式包。直接推送 `main`、关闭未合并 PR、从其他分支合入 `main` 均不触发正式发布。已有正式 Release 不覆盖；失败后留下的草稿可在同一提交重试，文件上传完成后才公开。

### 本地验证

CI 全部使用 `.sh` 入口，不调用 PowerShell。需要 Node.js 26、POSIX shell 和 Python 3；Python 标准库负责 ZIP 格式与逐项字节校验，不需要安装第三方 Python 包。

```sh
sh ci/test.sh
sh ci/run.sh verify redux-tweak
sh ci/run.sh verify redux-subject
sh ci/run.sh verify redux-test
sh ci/run.sh build nightly redux-tweak
sh ci/run.sh build nightly redux-subject
sh ci/run.sh build nightly redux-test
sh ci/run.sh build release redux-tweak
sh ci/run.sh build release redux-subject
sh ci/run.sh build release redux-test
```

产物位于 `dist/<mod-id>/`，每个 mod 分别计算输入指纹并构建；Redux Test 的指纹包含其依赖 Redux Tweak 的变化。玩家 ZIP 仅包含运行文件和许可证；校验和、构建元数据存放在 ZIP 外部。重复执行本地构建前需移走同名旧产物，打包器不会覆盖已有 ZIP。

### 添加其他 mod

在根目录添加 `<mod-id>/` 和 `<mod-id>.mod`，内外描述符版本及内容保持一致，启动器路径为 `mod/<mod-id>`。然后在 `ci/mods.json` 中注册唯一 ID、名称、完整运行文件白名单、测试输入及测试命令；确实依赖仓库内其他 mod 时才填写 `depends_on`。未登记的运行文件会导致打包校验失败。

新增 mod 不需要复制工作流。修改单个 mod 或其测试只影响该 mod 及声明的依赖方；共享构建输入影响引用方。修改 README 或本机同步脚本不生成新玩家包。调整某个 mod 的配置不会改变其他 mod 的输入指纹。

建议将 `main` 设置为必须通过 PR 合入，并要求 `Release Checks` 检查通过。
