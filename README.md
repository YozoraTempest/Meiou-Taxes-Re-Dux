# Meiou Taxes Redux

用于存放 MEIOU and Taxes v3.0 的独立 EU4 子模组。每个子模组有自己的目录和启动器描述符。需要覆盖 MT 的运行文件时，保留未修改的字节，并用固定样本验证改动范围。

## 子模组

| 名称 | 用途 | 状态 |
| --- | --- | --- |
| `redux-tweak` | 数值调整与基础设施施工并发修正 | `0.2.0`，订单池与逐槽完工调度 |
| `redux-subject` | 属国管理：省份选择、批量选择范围与建设修正 | `0.1.3`，独立选择按钮使用完整图案并直接更新地图图钉 |
| `redux-test` | 用决议和事件在游戏内验证施工并发 | `0.2.0`，七种场景、来源报告与调度核验 |

## redux-tweak

`redux-tweak.mod` 与 `redux-tweak/descriptor.mod` 依赖 `MEIOU and Taxes v3.0`，支持 EU4 `v1.37.*.*`。基础设施 ID 8–14 使用独立订单池，仍共享 MT 的十个省份施工槽。产业投资 ID 1–7 沿用 MT 的原有队列和完工规则。

### 施工调度

订单先进入省份订单池，保存建筑类型、出资方、请求并发、提交序号、下单来源和未开工数量。工作槽只保存一个已经开工的单位，当前单位的材料、劳动和已计支出由 MT 原流程维护。新订单可以在十个工作槽全满时提交；它会等待空槽，当前单位不会被取消或重置。

每个单位完工后，该槽立即释放并重新分配。阶级订单优先领取空槽，同一优先级内按提交顺序选择尚未达到并发上限的订单。没有玩家订单时，每笔阶级订单最多使用两个槽，多笔可以同时施工；存在玩家订单时，阶级合计最多使用两个槽，其他空槽供玩家订单使用。玩家自己的每笔请求并发继续生效。

如果玩家下单时阶级已占用八个槽，阶级当前八个单位继续施工，玩家先使用剩余两个槽。阶级单位逐个完成后，其重新开工的总并发限制到两个槽，其余释放的槽转交玩家。反过来，玩家已经占满十个槽时，新的阶级订单先排队，到玩家单位完工后才能取得槽位。此规则按当前单位完成调度；不用等整批十个单位全部完成。

年度结算先对原有单位计支出，再处理它们的材料与劳动完成量。结算开始时记录当前工作槽，刚领取的单位不会在同一次结算中再次完成。月度 `AAA` 钩子补齐空槽，开局人口模拟期间跳过。资金来源继续使用 MT 的规则；订单入队计入 `Infra_InConst` 总量，实际开工时抵消原助手的重复计数，完工时减少一个待建单位。

每省最多保存 32 笔未完成订单，正在工作池施工的订单也占一个记录。订单全部完成后记录可复用；订单池满时，玩家建设计算和阶级年度下单条件会阻止继续提交。单笔待建单位数量不受这个记录数量限制。状态报告显示未完成订单数和排队单位数。

### 现有存档

首次调度时，把旧施工槽中尚未开工的 `Size` 单位移入订单池，当前单位的剩余八种资源、出资方、请求并发、开工日期和支出保留。旧订单缺少来源和批次信息，按类型、出资方与请求并发合并，来源标为未知。未知来源订单与玩家订单一样限制新的阶级订单合计最多两个槽；不根据公共资金池猜测下单人。新订单分别记录来源和批次，相同类型、出资方、并发的两笔新订单仍有各自上限。

订单池数据保存在存档中。该存档有未开工订单时，需要继续启用 Redux Tweak 来调度；原版 MT 无法读取这些订单池记录。移除 Redux Tweak 前先完成或清理未完成订单。

### MT 运行入口

本机 MT 发布版已经把公共效果展开进事件，因此只替换 `common/scripted_effects` 无法接管年度完工与普通建设窗口。`ci/construction.mjs` 对固定的已安装 MT 样本生成同路径覆盖：基础设施公共效果与触发器、五个事件文件，以及格拉纳达决议。它接入 35 处基础设施下单入口、年度十个完工检查和建设准入条件，其余字节保持不变。国家 AI、玩家窗口、地方阶级年度建设、阶级事件与法院入口共用订单池。Redux Subject 的建设效果不变，通过 MT 公共入口使用新调度器。

原始样本压缩保存在 `verification/redux-tweak/mt-runtime/`，不进入玩家包。运行 `node ci/construction.mjs` 可重新生成覆盖文件；更新被支持的 MT 发布版时，先检查新版本差异，再运行 `node ci/construction.mjs capture "MT_DIRECTORY"` 重新采集并验证。其他模组若覆盖相同事件或基础设施文件，需要合并改动。

`verification/redux-tweak/VERIFY.mjs` 检查 646 个既有施工场景；`SCHEDULER.mjs` 检查订单池、逐槽调度、阶级条件上限、旧订单进度、年度检查、容量和记录复用，并验证交付文件与固定样本的生成结果一致。解释器检查不能代替 EU4 内的事件加载和自然年度经济结算。安装后重启游戏；可在测试存档使用 `event ReduxConstruction.1 AAA` 触发调度。

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
| `01：10 单位订单被限制为 2 个槽` | 四笔阶级道路订单占 8 槽，玩家 10 单位设施请求并发 10，只得到 2 槽 | 释放占位工程后立即变成 10，待建总量保持 10 |
| `02：同建筑类型、不同出资方` | 阶级设施 2 单位、玩家设施 10 单位 | 共用 10 槽，分别占 2 与 8；阶级上限保持 2 |
| `03：不同建筑类型共用施工槽` | 阶级道路 2 单位、玩家设施 10 单位 | 共用 10 槽，分别占 2 与 8，类型与出资方保留 |
| `04：真实并发 2 的对照组` | 玩家设施 10 单位，保存的请求并发为 2 | 补槽仍为 2；每次满供给施工检查完成 2 单位 |
| `05：先建阶级并发 2，再手动追加` | 只建立阶级道路 2 单位 | 使用原建设窗口手动追加一笔 10 单位基础设施，再查看请求并发与实际槽数 |

| `06：玩家占满 10 槽后阶级排队` | 玩家港口 20 单位占 10 槽，再提交两笔阶级订单，共 4 单位 | 初始玩家 10、阶级 0；推进一次完成原 10 单位后，玩家 8、阶级 2 |
| `07：阶级多笔施工后逐槽让位` | 四笔阶级道路订单各 4 单位，占 8 槽，再提交玩家港口 10 单位 | 初始阶级 8、玩家 2；推进一次后阶级 2、玩家 8；玩家完工后恢复阶级每笔上限 2 |

场景 01 的即时验证顺序为：保持暂停 → 确认建立场景 →「释放占位工程」→「执行补槽并核验」。结果事件检查真实活动槽、全部待建单位与各类 `Infra_InConst` 数量、原活动槽的建筑类型/出资方/请求并发/支出/八种剩余资源，以及相关省份资金。已有玩家单位设置为半程，用于验证补槽没有重置其进度；所有订单与资源成本通过 MT 原施工入口建立，没有复制 Redux Tweak 的补槽实现。

「查看施工状态」按新订单的来源标记区分玩家与阶级，不再把公共资金池直接视为玩家。它显示工作槽、未完工单位、排队单位、阶级排队数量和未完成订单数；旧存档的未知来源计入非玩家栏。阶级槽也计入非玩家槽，非玩家总数用于单一玩家订单的空槽核验。多笔玩家订单的类型与并发以参考订单为准，混合订单超出单订单补槽核验范围。

新调度测试先建立场景 06 或 07，保持暂停查看状态，再执行「满供给推进一次施工检查」。场景 06 初始玩家占 10 槽，阶级排队 4 单位；推进后应完成原有 10 个港口单位，工作池变为阶级 2、玩家 8，还有 2 个阶级单位排队。场景 07 初始阶级 8、玩家 2；推进后同样变为阶级 2、玩家 8，再推进一次玩家全部完成，剩余阶级订单可以按每笔两个槽领取空槽。

「满供给推进一次施工检查」临时将供给率设为 100%，只检查开始时已经在施工的单位，随后恢复原值。新开工单位留到下一轮检查。此操作实际增加建成单位，不模拟年度采购、劳动来源或付款。自然年度结算仍需推进到一月观察。

「触发 Tweak 实际补槽事件」对 `AAA` 调用 `ReduxConstruction.1`，作用于全部有效省份，推进一天后回报状态。月度调度不再限定二月；施工完工时也会立即调度。自然阶级建设是否入队及其付款、供给需要在一月结算后查看状态。

「清理剩余测试工程」只处理标记省份，取消该省尚未完成的基础设施队列并更新 MT 统计。它先删除订单池内的排队单位，暂停重新派工，再借助完工流程清槽并抵消临时增加的建成单位；此前实际完成的单位和已支付费用保留。产业项目 ID 1–7 保留，若仍有项目则保留标记并报告未清理完毕。测试期间不要在该省建立无关订单。测试场景会改变游戏状态，清理不是存档回滚。

同步测试工具和被测模组：

```sh
sh Sync-ReduxMods.sh "C:/Users/Vulon/OneDrive/文档/Paradox Interactive/Europa Universalis IV/mod" redux-tweak redux-test
```

测试场景、决议/事件入口、失败分支、月度触发、满供给完工、非抢占调度与清理通过 `verification/redux-test/VERIFY.mjs` 对两套 MT 效果样本解释执行。解释器和样本不进入玩家包，游戏加载、事件窗口及自然经济结算仍需 EU4 内验证。

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
