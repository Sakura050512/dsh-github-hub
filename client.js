/**
 * dsh-github-hub — 浏览器端。
 *
 * 在设置里加一个「GitHub 中心」页面：连接账号、浏览/管理仓库、看项目更新与 star 变化、
 * 直接把文件推到仓库。所有 GitHub 请求都由宿主端 /dsh-github-hub/* 代理，Token 不出宿主。
 */
window.__ModuleLoader__.load({
	id: 'dsh-github-hub',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useMemo, useRef, useState } = React

		const NS = 'settings.githubHub'
		const BASE = '/dsh-github-hub'
		const app = { ctx: null }

		const LANG_COLORS = ['#7c6cf5', '#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444']
		const CSS = `
.gh{display:flex;flex-direction:column;gap:14px;padding:2px 2px 40px;color:var(--dsw-alias-label-primary);font-size:14px;min-height:320px}
.gh-full{height:100%;overflow:auto;box-sizing:border-box;padding:26px 30px 40px;background:var(--dsw-alias-bg-layer-2)}
.gh-full .gh{max-width:1040px;margin:0 auto}
.gh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.gh-title{font-size:15px;font-weight:650;line-height:1.3}
.gh-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:3px;line-height:1.5}
.gh-btn{padding:3px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;line-height:1.7;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.gh-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-btn:disabled{opacity:.55;cursor:default}
.gh-btn[data-kind="primary"]{border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted)}
.gh-btn[data-kind="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted)}
.gh-btn[data-kind="ghost"]{border-color:transparent;padding:3px 8px}
.gh-btn[data-kind="danger"]:hover:not(:disabled){color:var(--dsw-alias-state-warn-label);border-color:var(--dsw-alias-state-warn-label)}
.gh-card{padding:11px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:9px;min-width:0}
.gh-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gh-row[data-wrap="1"]{flex-wrap:wrap}
.gh-avatar{width:30px;height:30px;border-radius:8px;object-fit:cover;background:var(--dsw-alias-bg-layer-3)}
.gh-login{font-weight:600;font-size:13px}
.gh-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;font-variant-numeric:tabular-nums}
.gh-input{box-sizing:border-box;padding:5px 9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;min-width:0;transition:border-color .15s ease}
.gh-input:focus{border-color:var(--gh-violet,#7c6cf5)}
.gh-input[data-flex="1"]{flex:1 1 220px}
.gh-textarea{box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;width:100%;min-height:150px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;line-height:1.5}
.gh-textarea:focus{border-color:var(--gh-violet,#7c6cf5)}
.gh-tabs{display:flex;gap:2px;flex-wrap:wrap;padding:2px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:fit-content;max-width:100%}
.gh-tab{padding:3px 9px;border-radius:6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;line-height:1.6;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,color .15s ease}
.gh-tab:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,17,21,.05));color:var(--dsw-alias-label-primary)}
.gh-tab[data-on="1"]{background:var(--dsw-alias-bg-layer-1);color:var(--gh-violet,#7c6cf5);box-shadow:0 1px 2px rgba(15,17,21,.08)}
body[data-ds-dark-theme] .gh-tabs{background:rgba(255,255,255,.04)}
body[data-ds-dark-theme] .gh-tab[data-on="1"]{background:rgba(255,255,255,.1)}
.gh-sub-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:9px;border:1px dashed var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.gh-check{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.gh-check input{accent-color:var(--gh-violet,#7c6cf5);margin:0}
.gh-tag[data-kind="star"]{background:color-mix(in srgb,#f59e0b 18%,transparent);color:#b45309}
.gh-tag[data-kind="track"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.gh-btn[data-on="1"]{color:var(--gh-violet,#7c6cf5)}
.gh-list{display:flex;flex-direction:column;gap:7px}
.gh-repo{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.gh-repo:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);transform:translateY(-1px);box-shadow:0 4px 14px rgba(15,17,21,.06)}
.gh-repo{transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease;gap:5px}
.gh-langdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}
.gh-langcell{display:inline-flex;align-items:center;gap:5px}
.gh-repo[data-tracked="1"]{border-color:var(--gh-violet,#7c6cf5)}
.gh-name{font-weight:600;font-size:13px;word-break:break-all}
.gh-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:18px}
.gh-meta{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gh-tag{padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-3);font-size:10px;color:var(--dsw-alias-label-tertiary)}
.gh-tag[data-kind="track"]{background:var(--gh-violet,#7c6cf5);color:var(--dsw-alias-label-primary-inverted)}
.gh-star{display:inline-flex;align-items:center;gap:3px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.gh-state{padding:22px 12px;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.7}
.gh-state[data-kind="error"]{color:var(--dsw-alias-state-warn-label)}
.gh-note{font-size:12px;line-height:1.55;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.gh-note[data-kind="error"]{color:var(--dsw-alias-state-warn-label)}
.gh-note[data-kind="done"]{color:#16a34a}
.gh-feed{display:flex;flex-direction:column;gap:2px}
.gh-feed-item{display:flex;align-items:baseline;gap:8px;padding:7px 2px 7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);border-left:2px solid transparent;font-size:12px;line-height:1.5}
.gh-feed-item[data-kind="push"]{border-left-color:#7c6cf5}
.gh-feed-item[data-kind="create"]{border-left-color:#22c55e}
.gh-feed-item[data-kind="star"]{border-left-color:#f59e0b}
.gh-feed-item[data-kind="issue"]{border-left-color:#ec4899}
.gh-feed-item[data-kind="pr"]{border-left-color:#3b82f6}
.gh-feed-item[data-kind="release"]{border-left-color:#06b6d4}
.gh-feed-item[data-kind="commit"]{border-left-color:#a855f7}
.gh-feed-item:last-child{border-bottom:none}
.gh-feed-at{color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
.gh-feed-repo{font-weight:600;white-space:nowrap}
.gh-feed-sum{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis}
.gh-spark{display:block}
.gh-star-chart .gh-spark{width:100%;height:60px}
.gh-star-list{display:flex;flex-direction:column;gap:10px}
.gh-star-card{display:flex;flex-direction:column;gap:6px;padding:11px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.gh-star-row{display:flex;align-items:baseline;gap:9px;font-size:12px}
.gh-star-name{font-weight:650;font-size:12px;word-break:break-all}
.gh-star-num{font-variant-numeric:tabular-nums;font-size:24px;font-weight:700;color:var(--gh-amber,#f59e0b);letter-spacing:-.02em;margin-left:auto}
.gh-star-unit{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gh-star-chip{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-star-chart{padding:0}
.gh-star-delta{font-variant-numeric:tabular-nums;font-size:11px}
.gh-star-delta[data-kind="up"]{color:#16a34a}
.gh-star-delta[data-kind="flat"]{color:var(--dsw-alias-label-tertiary)}
.gh-grid2{display:grid;grid-template-columns:minmax(140px,1fr) minmax(140px,1fr);gap:8px}
.gh-field{display:flex;flex-direction:column;gap:4px}
.gh-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gh-link{color:var(--gh-violet,#7c6cf5);text-decoration:none;font-size:11.5px;font-weight:600}
.gh-link:hover{text-decoration:underline}
.gh{--gh-violet:#7c6cf5;--gh-blue:#3b82f6;--gh-green:#22c55e;--gh-amber:#f59e0b;--gh-pink:#ec4899;--gh-cyan:#06b6d4}
.gh-dash{display:flex;flex-direction:column;gap:10px}
.gh-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}
.gh-stat{position:relative;overflow:hidden;padding:10px 11px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:1px;min-width:0}
.gh-stat::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--gh-c,var(--gh-violet))}
.gh-stat::after{content:'';position:absolute;bottom:-30px;right:-30px;width:72px;height:72px;border-radius:50%;background:var(--gh-c,var(--gh-violet));opacity:.06;overflow:hidden}
.gh-stat[data-kind="repos"]{--gh-c:var(--gh-violet)}
.gh-stat[data-kind="stars"]{--gh-c:var(--gh-amber)}
.gh-stat[data-kind="forks"]{--gh-c:var(--gh-blue)}
.gh-stat[data-kind="issues"]{--gh-c:var(--gh-pink)}
.gh-stat[data-kind="unread"]{--gh-c:var(--gh-green)}
.gh-stat-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;margin-top:2px}
.gh-stat-value{font-size:22px;font-weight:700;line-height:1.2;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--gh-c,var(--dsw-alias-label-primary));margin:2px 0 1px}
.gh-stat-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gh-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.gh-chart{display:flex;flex-direction:column;gap:6px;min-height:132px}
.gh-chart-svg{width:100%;height:112px;min-height:112px;flex:1 1 112px;display:block;overflow:visible}
.gh-chart-foot{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-heat{display:flex;flex-direction:column;gap:7px;padding-top:2px}
.gh-heat-grid{display:flex;gap:3px;overflow:hidden}
.gh-heat-col{display:flex;flex-direction:column;gap:3px;flex:1 1 0;min-width:0}
.gh-heat-cell{aspect-ratio:1;width:100%;border-radius:2.5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.gh-heat-cell[data-level="1"]{background:#cdf3d9}
.gh-heat-cell[data-level="2"]{background:#77e29c}
.gh-heat-cell[data-level="3"]{background:#22c55e}
.gh-heat-cell[data-level="4"]{background:#0f7a3d}
body[data-ds-dark-theme] .gh-heat-cell[data-level="1"]{background:#0e4429}
body[data-ds-dark-theme] .gh-heat-cell[data-level="2"]{background:#12833c}
body[data-ds-dark-theme] .gh-heat-cell[data-level="3"]{background:#26c15e}
body[data-ds-dark-theme] .gh-heat-cell[data-level="4"]{background:#3ddb78}
.gh-heat-months{display:flex;gap:3px;margin-bottom:3px}
.gh-heat-month{flex:1 1 0;min-width:0;font-size:9px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:visible}
.gh-heat-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.gh-heat-side{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-heat-foot{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.gh-langwrap{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.gh-donut{position:relative;flex:0 0 auto;width:108px;height:108px;border-radius:50%}
.gh-donut::after{content:'';position:absolute;inset:26%;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1)}
.gh-donut-label{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:9px;color:var(--dsw-alias-label-secondary);line-height:1.15}
.gh-donut-label b{font-size:15px;font-weight:700;line-height:1.1;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.gh-legend{display:flex;flex-direction:column;gap:7px;flex:1 1 140px;min-width:0}
.gh-legend-row{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gh-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%}
.gh-legend-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-legend-num{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-bars{display:flex;flex-direction:column;gap:7px}
.gh-bar{display:flex;align-items:center;gap:8px;font-size:11px}
.gh-bar-name{flex:0 0 104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.gh-bar-track{flex:1 1 auto;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.gh-bar-fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--gh-violet),var(--gh-blue))}
.gh-bar-num{flex:0 0 auto;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-recent{display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;text-decoration:none;color:inherit}
.gh-recent:last-child{border-bottom:none}
.gh-recent:hover .gh-recent-name{color:var(--gh-violet)}
.gh-recent-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-recent-at{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
@media (max-width:860px){.gh-split{grid-template-columns:minmax(0,1fr)}}
.gh-panel{display:flex;flex-direction:column;gap:9px}
.gh-item{display:flex;flex-direction:column;gap:5px;padding:9px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);text-align:left;font:inherit;color:inherit;cursor:pointer}
.gh-item:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.gh-item-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.gh-item-num{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-item-title{font-weight:600;font-size:13px;line-height:1.4}
.gh-item-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gh-item-at{margin-left:auto;white-space:nowrap}
.gh-body{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto}
.gh-diff{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.gh-diff-head{padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);word-break:break-all}
.gh-diff-body{margin:0;padding:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:11px;line-height:1.55;overflow:auto;max-height:320px}
.gh-diff-line{padding:0 10px;white-space:pre;color:var(--dsw-alias-label-secondary)}
.gh-diff-line[data-kind="add"]{background:color-mix(in srgb,#22c55e 16%,transparent);color:var(--dsw-alias-label-primary)}
.gh-diff-line[data-kind="del"]{background:color-mix(in srgb,#ef4444 14%,transparent);color:var(--dsw-alias-label-primary)}
.gh-diff-line[data-kind="hunk"]{color:var(--dsw-alias-label-tertiary)}
.gh-files{display:flex;flex-direction:column;gap:9px;padding:2px 0 6px}
.gh-file-row{display:flex;flex-direction:column;gap:5px;padding:9px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.gh-file-head{display:flex;align-items:center;gap:7px}
.gh-file-index{font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.gh-file-path{flex:1 1 auto;min-width:0}
.gh-file-body{min-height:92px}
.gh-logs{display:flex;flex-direction:column;gap:7px;padding:9px 0 2px}
.gh-log-pre{max-height:280px;overflow:auto;margin:0;padding:9px 11px;border-radius:9px;background:color-mix(in srgb,#0f1115 6%,transparent);font-size:11px;line-height:1.55;white-space:pre;tab-size:2}
body[data-ds-dark-theme] .gh-log-pre{background:color-mix(in srgb,#fff 6%,transparent)}

.gh-select{height:28px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;max-width:280px}
.gh-device{display:flex;flex-direction:column;gap:8px;padding:12px 0 2px}
.gh-device-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.gh-device-code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:30px;font-weight:700;letter-spacing:.16em;color:var(--gh-amber,#f59e0b);padding:8px 0 2px}
.gh-run{display:flex;flex-direction:column;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);padding:9px 11px;margin-bottom:8px}
.gh-run-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.gh-run-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-tertiary)}
.gh-run-dot[data-kind="ok"]{background:#22c55e}
.gh-run-dot[data-kind="bad"]{background:#ef4444}
.gh-run-dot[data-kind="running"]{background:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.gh-run-dot[data-kind="flat"]{background:#a1a1aa}
.gh-run-title{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-weight:650;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;flex:1 1 220px;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.gh-run-title:hover{color:var(--gh-violet,#7c6cf5)}
.gh-run-status{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.gh-run-status[data-kind="ok"]{background:rgba(34,197,94,.14);color:#16a34a}
.gh-run-status[data-kind="bad"]{background:rgba(239,68,68,.14);color:#dc2626}
.gh-run-status[data-kind="running"]{background:rgba(59,130,246,.14);color:#2563eb}
.gh-run-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-run-actions{display:flex;align-items:center;gap:6px;margin-left:auto}
.gh-jobs{margin-top:9px;padding-top:9px;border-top:1px dashed var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:8px}
.gh-job{display:flex;flex-direction:column;gap:5px}
.gh-job-head{display:flex;align-items:center;gap:7px;font-size:12px;flex-wrap:wrap}
.gh-job-name{font-weight:600}
.gh-steps{display:flex;flex-direction:column;gap:2px;padding-left:15px}
.gh-step{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.gh-step-num{width:16px;text-align:right;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-step[data-kind="ok"] .gh-step-state{color:#16a34a}
.gh-step[data-kind="bad"] .gh-step-state{color:#dc2626}
.gh-step-state{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.gh-tree{display:flex;flex-direction:column;max-height:560px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:2px 0}
.gh-tree-item{display:flex;align-items:center;gap:6px;appearance:none;border:0;background:transparent;padding:3px 10px;cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-primary);text-align:left;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;line-height:1.7;width:100%;transition:background-color .15s ease}
.gh-tree-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,17,21,.04))}
.gh-tree-caret{width:10px;flex:0 0 10px;text-align:center;font-size:8px;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;opacity:.85}
.gh-tree-caret[data-open="1"]{transform:rotate(90deg)}
.gh-tree-icon{width:12px;flex:0 0 12px;text-align:center;font-size:10px;line-height:1;opacity:.7}
.gh-tree-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.gh-tree-name[data-dir="1"]{font-weight:600}
.gh-tree-size{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:0 0 auto;padding-left:10px;opacity:.85}
body[data-ds-dark-theme] .gh-tree{background:var(--dsw-alias-bg-layer-2)}
.gh-file{display:flex;flex-direction:column;gap:8px}
.gh-crumb{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:11.5px;padding:2px 2px 6px;margin-bottom:6px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.gh-crumb-path{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-weight:650;word-break:break-all}
.gh-crumb-size{font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gh-code{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);max-height:600px;overflow:auto;padding:6px 0}
.gh-code-line{display:flex;gap:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:11.5px;line-height:1.7;padding:0 12px}
.gh-code-line:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,17,21,.03))}
.gh-code-num{width:38px;flex:0 0 auto;text-align:right;color:var(--dsw-alias-label-tertiary);user-select:none;font-variant-numeric:tabular-nums;opacity:.75}
.gh-code-text{white-space:pre-wrap;word-break:break-all}
.gh-report{display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.gh-report-pre{margin:0;padding:10px 12px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;overflow:auto;max-height:280px}
body[data-ds-dark-theme] .gh-code,body[data-ds-dark-theme] .gh-report,body[data-ds-dark-theme] .gh-run{background:var(--dsw-alias-bg-layer-2)}
`

		function api(path, options) {
			const init = options === undefined ? {} : { ...options }
			init.headers = { 'content-type': 'application/json', ...(init.headers ?? {}) }
			if (init.body !== undefined && typeof init.body !== 'string') init.body = JSON.stringify(init.body)
			if (init.signal === undefined) init.signal = AbortSignal.timeout(options !== undefined && Number.isFinite(options.timeoutMs) ? options.timeoutMs : 120_000)
			return fetch(BASE + path, init).then((response) =>
				response.json().then(
					(payload) => {
						if (!response.ok || payload === null || payload.ok !== true) {
							const message = payload !== null && typeof payload.message === 'string' ? payload.message : `HTTP ${response.status}`
							const code = payload !== null && typeof payload.code === 'string' ? payload.code : 'ERROR'
							throw new Error(`${code}: ${message}`)
						}
						return payload
					},
					() => { throw new Error(`HTTP ${response.status}`) },
				),
			)
		}

		function formatCount(value) {
			if (!Number.isFinite(value) || value <= 0) return '0'
			if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M'
			if (value >= 1000) return (value / 1000).toFixed(1) + 'k'
			return String(value)
		}

		function timeAgo(value) {
			const then = typeof value === 'number' ? value : (typeof value === 'string' ? Date.parse(value) : NaN)
			if (!Number.isFinite(then)) return ''
			const diff = Date.now() - then
			if (diff < 60_000) return '刚刚'
			if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
			if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
			if (diff < 30 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前'
			return new Date(then).toLocaleDateString()
		}

		let sparkSeq = 0
		function Spark({ points, width = 640, height = 56 }) {
			const id = useMemo(() => 'ghsp' + ++sparkSeq, [])
			if (!Array.isArray(points) || points.length < 2) return null
			const values = points.map((point) => point.s)
			const min = Math.min(...values)
			const max = Math.max(...values)
			const span = max - min === 0 ? 1 : max - min
			const step = width / (points.length - 1)
			const y = (value) => height - ((value - min) / span) * (height - 6) - 3
			const coords = points.map((point, index) => `${(index * step).toFixed(1)},${y(point.s).toFixed(1)}`)
			const lastX = ((points.length - 1) * step).toFixed(1)
			const lastY = y(values[values.length - 1]).toFixed(1)
			return h(
				'svg',
				{ className: 'gh-spark', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', preserveAspectRatio: 'none' },
				h(
					'defs',
					null,
					h('linearGradient', { id: id + 'a', x1: '0', y1: '0', x2: '0', y2: '1' }, h('stop', { offset: '0%', 'stop-color': '#7c6cf5', 'stop-opacity': '0.30' }), h('stop', { offset: '100%', 'stop-color': '#7c6cf5', 'stop-opacity': '0.02' })),
					h('linearGradient', { id: id + 'b', x1: '0', y1: '0', x2: '1', y2: '0' }, h('stop', { offset: '0%', 'stop-color': '#7c6cf5' }), h('stop', { offset: '100%', 'stop-color': '#3b82f6' })),
				),
				h('polygon', { points: '0,' + height + ' ' + coords.join(' ') + ' ' + lastX + ',' + height, fill: 'url(#' + id + 'a)' }),
				h('polyline', {
					points: coords.join(' '),
					fill: 'none',
					stroke: 'url(#' + id + 'b)',
					'stroke-width': '2',
					'stroke-linecap': 'round',
					'stroke-linejoin': 'round',
					'vector-effect': 'non-scaling-stroke',
				}),
				h('circle', { cx: lastX, cy: lastY, r: '3', fill: '#3b82f6' }),
			)
		}

		function ConnectCard({ onConnected }) {
			const [token, setToken] = useState('')
			const [busy, setBusy] = useState(false)
			const [error, setError] = useState(null)

			const submit = useCallback(() => {
				const value = token.trim()
				if (value === '' || busy) return
				setBusy(true)
				setError(null)
				api('/token', { method: 'POST', body: { token: value } })
					.then((payload) => {
						setToken('')
						if (typeof onConnected === 'function') onConnected(payload)
					})
					.catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
					.finally(() => setBusy(false))
			}, [token, busy, onConnected])

			return h(
				'div',
				{ className: 'gh-card' },
				h('div', { className: 'gh-title' }, '连接 GitHub'),
				h(
					'div',
					{ className: 'gh-hint' },
					'粘一个 Personal Access Token（classic 勾 repo，或 fine-grained 给 Contents 读写权限）。Token 存在 DSH 的凭据库里，不会写进插件配置，也不会回传给界面。',
				),
				h(
					'div',
					{ className: 'gh-row' },
					h('input', {
						className: 'gh-input',
						'data-flex': '1',
						type: 'password',
						placeholder: 'ghp_… 或 github_pat_…',
						value: token,
						autoComplete: 'off',
						onChange: (event) => setToken(event.target.value),
						onKeyDown: (event) => { if (event.key === 'Enter') submit() },
					}),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || token.trim() === '', onClick: submit }, busy ? '验证中…' : '连接'),
					h('a', { className: 'gh-link', href: 'https://github.com/settings/tokens', target: '_blank', rel: 'noreferrer' }, '创建 Token'),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				h(DeviceLogin, { onConnected }),
			)
		}

		function RepoList({ state, error, onTrack, onRefreshOne, onStar, onCreated, busyFull, notice }) {
			const [query, setQuery] = useState('')
			const [affiliation, setAffiliation] = useState('owner,collaborator,organization_member')
			const [creating, setCreating] = useState(false)
			const repos = state === null ? [] : state.items ?? []
			const view = useMemo(() => {
				const needle = query.trim().toLowerCase()
				if (needle === '') return repos
				return repos.filter((repo) => repo.full.toLowerCase().includes(needle) || repo.description.toLowerCase().includes(needle) || repo.language.toLowerCase().includes(needle))
			}, [repos, query])
			const empty = error !== null && error !== undefined
				? h('div', { className: 'gh-note', 'data-kind': 'error' }, error.message ?? String(error))
				: h('div', { className: 'gh-state' }, state === null ? '正在读取仓库…' : '没有匹配的仓库')
			return h(
				'div',
				{ className: 'gh-card' },
				h(
					'div',
					{ className: 'gh-row' },
					h('input', { className: 'gh-input', 'data-flex': '1', type: 'search', placeholder: '按名字、描述、语言筛选…', value: query, onChange: (event) => setQuery(event.target.value) }),
					h(
						'select',
						{ className: 'gh-input', value: affiliation, onChange: (event) => setAffiliation(event.target.value) },
						h('option', { value: 'owner,collaborator,organization_member' }, '全部仓库'),
						h('option', { value: 'owner' }, '我创建的'),
						h('option', { value: 'organization_member' }, '组织的'),
					),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', onClick: () => setCreating((previous) => !previous) }, creating ? '收起' : '新建仓库'),
				),
				creating ? h(RepoCreate, { onDone: (full) => { setCreating(false); if (typeof onCreated === 'function') onCreated(full) } }) : null,
				notice === null ? null : h('div', { className: 'gh-note', 'data-kind': notice.kind === 'error' ? 'error' : 'done' }, notice.text),
				view.length === 0
					? empty
					: h(
						'div',
						{ className: 'gh-list' },
						view.map((repo) =>
							h(
								'div',
								{ className: 'gh-repo', key: repo.full, 'data-tracked': repo.tracked ? '1' : '0' },
								h(
									'div',
									{ className: 'gh-row' },
									h('span', { className: 'gh-name' }, repo.full),
									repo.private ? h('span', { className: 'gh-tag' }, '私有') : null,
									repo.fork ? h('span', { className: 'gh-tag' }, 'Fork') : null,
									repo.archived ? h('span', { className: 'gh-tag' }, '归档') : null,
									repo.tracked ? h('span', { className: 'gh-tag', 'data-kind': 'track' }, '记录中') : null,
									repo.starred ? h('span', { className: 'gh-tag', 'data-kind': 'star' }, '已 star') : null,
								),
								h('div', { className: 'gh-desc' }, repo.description === '' ? '（没有描述）' : repo.description),
								h(
									'div',
									{ className: 'gh-meta' },
									h('span', { className: 'gh-star' }, '★ ' + formatCount(repo.stars)),
									h('span', null, 'Fork ' + formatCount(repo.forks)),
									h('span', null, 'Issue ' + formatCount(repo.openIssues)),
									repo.language === ''
										? null
										: h(
											'span',
											{ className: 'gh-langcell' },
											h('span', { className: 'gh-langdot', style: { background: LANG_COLORS[(repo.language.length + repo.language.charCodeAt(0)) % LANG_COLORS.length] } }),
											h('span', null, repo.language),
										),
									repo.pushedAt === null ? null : h('span', null, '更新于 ' + timeAgo(repo.pushedAt)),
									repo.recordedStars !== null && repo.recordedStars !== repo.stars ? h('span', null, '上次记录 ' + formatCount(repo.recordedStars)) : null,
								),
								h(
									'div',
									{ className: 'gh-row' },
									h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => onTrack(repo.full, !repo.tracked) }, repo.tracked ? '取消记录' : '记录 star'),
									h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', disabled: busyFull === repo.full, onClick: () => onRefreshOne(repo.full) }, busyFull === repo.full ? '刷新中…' : '立即刷新'),
									h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', 'data-on': repo.starred ? '1' : '0', disabled: busyFull === repo.full, onClick: () => onStar(repo.full, !repo.starred) }, repo.starred ? '取消 star' : 'Star'),
									h('a', { className: 'gh-link', href: repo.htmlUrl, target: '_blank', rel: 'noreferrer' }, '打开 GitHub'),
									h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => { navigator.clipboard?.writeText(repo.full) } }, '复制名字'),
								),
							),
						),
					),
			)
		}

		function RepoCreate({ onDone }) {
			const [name, setName] = useState('')
			const [description, setDescription] = useState('')
			const [isPrivate, setIsPrivate] = useState(false)
			const [tracked, setTracked] = useState(true)
			const [busy, setBusy] = useState(false)
			const [error, setError] = useState(null)
			const submit = useCallback(() => {
				const value = name.trim()
				if (value === '' || busy) return
				setBusy(true)
				setError(null)
				api('/create-repo', { method: 'POST', body: { name: value, description, private: isPrivate, tracked } })
					.then((payload) => { setName(''); setDescription(''); onDone(payload.full) })
					.catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
					.finally(() => setBusy(false))
			}, [name, description, isPrivate, tracked, busy, onDone])
			return h(
				'div',
				{ className: 'gh-sub-card' },
				h('div', { className: 'gh-row' },
					h('input', { className: 'gh-input', 'data-flex': '1', placeholder: '仓库名（字母/数字/点/下划线/短横线）', value: name, onChange: (event) => setName(event.target.value) }),
					h('input', { className: 'gh-input', 'data-flex': '1', placeholder: '描述（可选）', value: description, onChange: (event) => setDescription(event.target.value) }),
				),
				h('div', { className: 'gh-row' },
					h('label', { className: 'gh-check' }, h('input', { type: 'checkbox', checked: isPrivate, onChange: (event) => setIsPrivate(event.target.checked) }), '私有'),
					h('label', { className: 'gh-check' }, h('input', { type: 'checkbox', checked: tracked, onChange: (event) => setTracked(event.target.checked) }), '创建后记录 star'),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || name.trim() === '', onClick: submit }, busy ? '创建中…' : '创建'),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
			)
		}

		function RefreshSettings({ settings, onSave }) {
			const [hours, setHours] = useState(String(settings?.refreshHours ?? 6))
			useEffect(() => { setHours(String(settings?.refreshHours ?? 6)) }, [settings?.refreshHours])
			const auto = settings?.autoRefresh !== false
			const last = settings?.lastRefreshAt ?? null
			const save = () => {
				const value = Number(hours)
				if (!Number.isFinite(value)) return
				onSave({ refreshHours: Math.min(168, Math.max(1, Math.round(value))) })
			}
			return h(
				"div",
				{ className: "gh-sub-card" },
				h(
					"div",
					{ className: "gh-row" },
					h("span", { className: "gh-label" }, "自动记录间隔"),
					h("input", { className: "gh-input", type: "number", min: "1", max: "168", value: hours, onChange: (event) => setHours(event.target.value), style: { width: "76px" } }),
					h("span", { className: "gh-hint" }, "小时（1–168）"),
					h("button", { type: "button", className: "gh-btn", onClick: save }, "保存"),
					h(
					"label",
					{ className: "gh-check", style: { marginLeft: "auto" } },
					h("input", { type: "checkbox", checked: auto, onChange: (event) => onSave({ autoRefresh: event.target.checked }) }),
					"自动刷新",
				),
				),
				h("div", { className: "gh-hint" }, last === null ? "还没有记录过" : "上次记录 " + timeAgo(last)),
			)
		}

		function StarPanel({ tracked, stars, settings, onRefresh, onSaveSettings, busy, notice }) {
			const rows = tracked.map((full) => {
				const entry = stars[full] ?? null
				const history = entry === null ? [] : entry.history ?? []
				const first = history.length > 0 ? history[0] : null
				const last = history.length > 0 ? history[history.length - 1] : null
				return { full, entry, history, first, last }
			})
			return h(
				'div',
				{ className: 'gh-card' },
				h(
					'div',
					{ className: 'gh-row' },
					h('div', { className: 'gh-title' }, 'Star 记录'),
					h('span', { className: 'gh-hint' }, tracked.length === 0 ? '还没有记录任何仓库' : `${tracked.length} 个仓库在跟踪`),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || tracked.length === 0, onClick: onRefresh, style: { marginLeft: 'auto' } }, busy ? '刷新中…' : '刷新全部'),
				),
				notice === null ? null : h('div', { className: 'gh-note', 'data-kind': notice.kind === 'error' ? 'error' : 'done' }, notice.text),
				h(RefreshSettings, { settings, onSave: onSaveSettings }),
					h(ReportBox, null),
				tracked.length === 0
					? h('div', { className: 'gh-state' }, '去「仓库」里点「记录 star」，就会每天存一个快照，并画出趋势。')
					: h(
						'div',
						{ className: 'gh-star-list' },
						rows.map((row) => {
							const delta = row.first === null || row.last === null ? null : row.last.s - row.first.s
							return h(
								'div',
								{ className: 'gh-star-card', key: row.full },
								h(
									'div',
									{ className: 'gh-star-row' },
									h('span', { className: 'gh-star-name' }, row.full),
									delta === null || delta === 0
										? null
										: h('span', { className: 'gh-star-delta', 'data-kind': delta > 0 ? 'up' : 'flat' }, (delta > 0 ? '+' : '') + delta),
									h('span', { className: 'gh-star-num' }, formatCount(row.entry === null ? 0 : row.entry.stars ?? 0)),
									h('span', { className: 'gh-star-unit' }, 'star'),
									h('span', { className: 'gh-star-chip' }, row.history.length === 0 ? '还没有快照' : '历史 ' + row.history.length + ' 天'),
								),
								h('div', { className: 'gh-star-chart' }, h(Spark, { points: row.history.slice(-60) })),
							)
						}),
					),
			)
		}

		function feedKind(item) {
			if (item.kind === 'commit') return 'commit'
			const type = typeof item.type === 'string' ? item.type : ''
			if (type === 'PushEvent') return 'push'
			if (type === 'CreateEvent') return 'create'
			if (type === 'WatchEvent') return 'star'
			if (type === 'IssuesEvent') return 'issue'
			if (type === 'PullRequestEvent') return 'pr'
			if (type === 'ReleaseEvent') return 'release'
			return 'commit'
		}

		function FeedPanel({ feed, onReload, loading }) {
			return h(
				'div',
				{ className: 'gh-card' },
				h(
					'div',
					{ className: 'gh-row' },
					h('div', { className: 'gh-title' }, '项目更新'),
					h('span', { className: 'gh-hint' }, '你的公开活动和跟踪仓库的最新提交'),
					h('button', { type: 'button', className: 'gh-btn', disabled: loading, onClick: onReload, style: { marginLeft: 'auto' } }, loading ? '读取中…' : '重新读取'),
				),
				feed === null
					? h('div', { className: 'gh-state' }, loading ? '正在读取更新…' : '还没有数据')
					: feed.length === 0
						? h('div', { className: 'gh-state' }, '最近没有公开活动')
						: h(
							'div',
							{ className: 'gh-feed' },
							feed.map((item, index) =>
								h(
									'div',
									{ className: 'gh-feed-item', key: (item.url ?? '') + index, 'data-kind': feedKind(item) },
									h('span', { className: 'gh-feed-at' }, timeAgo(item.at)),
									h('a', { className: 'gh-feed-repo gh-link', href: item.url, target: '_blank', rel: 'noreferrer' }, item.repo),
									h('span', { className: 'gh-feed-sum' }, item.summary),
								),
							),
						),
			)
		}

		function PushPanel({ repos, tracked, notice, setNotice }) {
			const [full, setFull] = useState('')
			const [branch, setBranch] = useState('')
			const [files, setFiles] = useState([{ path: '', content: '' }])
			const [message, setMessage] = useState('')
			const [busy, setBusy] = useState(false)
			const [result, setResult] = useState(null)

			const options = useMemo(() => {
				const names = new Set([...tracked, ...repos.map((repo) => repo.full)])
				return [...names].sort()
			}, [repos, tracked])

			const update = useCallback((index, patch) => {
				setFiles((current) => current.map((file, at) => (at === index ? { ...file, ...patch } : file)))
			}, [])

			const addFile = useCallback(() => {
				setFiles((current) => [...current, { path: '', content: '' }])
			}, [])

			const removeFile = useCallback((index) => {
				setFiles((current) => (current.length <= 1 ? current : current.filter((_, at) => at !== index)))
			}, [])

			const usable = files.filter((file) => file.path.trim() !== '')

			const submit = useCallback(() => {
				const target = full.trim()
				if (target === '' || usable.length === 0 || busy) return
				setBusy(true)
				setResult(null)
				setNotice(null)
				api('/push', {
					method: 'POST',
					body: {
						full: target,
						branch: branch.trim(),
						message: message.trim(),
						files: usable.map((file) => ({ path: file.path.trim(), content: file.content })),
					},
				})
					.then((payload) => {
						setResult(payload)
						setNotice({ kind: 'ok', text: `已提交到 ${payload.branch}：${payload.commit.slice(0, 7)}` })
					})
					.catch((cause) => setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) }))
					.finally(() => setBusy(false))
			}, [full, branch, usable, message, busy, setNotice])

			return h(
				'div',
				{ className: 'gh-card' },
				h('div', { className: 'gh-title' }, '提交代码'),
				h(
					'div',
					{ className: 'gh-hint' },
					'走 GitHub 的 Git Data API：多个文件合进同一次 commit，自动带上当前分支的最新提交作为父提交，不会强推、不会覆盖别人的改动。',
				),
				h(
					'div',
					{ className: 'gh-grid2' },
					h(
						'div',
						{ className: 'gh-field' },
						h('span', { className: 'gh-label' }, '仓库'),
						h(
							'select',
							{ className: 'gh-input', value: full, onChange: (event) => setFull(event.target.value) },
							h('option', { value: '' }, '选择仓库…'),
							options.map((name) => h('option', { key: name, value: name }, name)),
						),
					),
					h(
						'div',
						{ className: 'gh-field' },
						h('span', { className: 'gh-label' }, '分支（留空 = 默认分支）'),
						h('input', { className: 'gh-input', placeholder: 'main', value: branch, onChange: (event) => setBranch(event.target.value) }),
					),
					h(
						'div',
						{ className: 'gh-field' },
						h('span', { className: 'gh-label' }, '提交说明'),
						h('input', { className: 'gh-input', placeholder: 'docs: 更新说明', value: message, onChange: (event) => setMessage(event.target.value) }),
					),
				),
				h('div', { className: 'gh-label' }, '文件（' + usable.length + ' 个）'),
				h('div', { className: 'gh-files' },
					files.map((file, index) => h('div', { className: 'gh-file-row', key: index },
						h('div', { className: 'gh-file-head' },
							h('span', { className: 'gh-file-index' }, '#' + (index + 1)),
							h('input', {
								className: 'gh-input gh-file-path',
								placeholder: 'notes/today.md',
								value: file.path,
								onChange: (event) => update(index, { path: event.target.value }),
							}),
							files.length <= 1 ? null : h('button', {
								type: 'button',
								className: 'gh-btn',
								'data-kind': 'ghost',
								onClick: () => removeFile(index),
							}, '删除'),
						),
						h('textarea', {
							className: 'gh-textarea gh-file-body',
							placeholder: file.path === '' ? '先填路径，再写内容…' : '内容（' + file.path + '）…',
							value: file.content,
							onChange: (event) => update(index, { content: event.target.value }),
						}),
					)),
				),
				h('div', { className: 'gh-row' },
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: addFile, disabled: busy }, '+ 再加一个文件'),
					h('label', { className: 'gh-btn', 'data-kind': 'ghost' }, '从本机选文件填充',
						h('input', {
							type: 'file',
							multiple: true,
							style: { display: 'none' },
							accept: 'text/*,.md,.json,.js,.ts,.css,.html,.yml,.yaml,.toml,.py,.java,.go,.rs,.sh,.txt',
							onChange: (event) => {
								const picked = Array.from(event.target.files || [])
								event.target.value = ''
								if (picked.length === 0) return
								Promise.all(picked.map((entry) => new Promise((resolve) => {
									const reader = new FileReader()
									reader.onload = () => resolve({ path: entry.name, content: typeof reader.result === 'string' ? reader.result : '' })
									reader.onerror = () => resolve(null)
									reader.readAsText(entry)
								}))).then((loaded) => {
									const good = loaded.filter((entry) => entry !== null)
									setFiles((current) => {
										const kept = current.filter((file) => file.path.trim() !== '' || file.content !== '')
										return [...kept, ...good]
									})
								})
							},
						})),
					),
				notice === null ? null : h('div', { className: 'gh-note', 'data-kind': notice.kind === 'error' ? 'error' : 'done' }, notice.text),
				h(
					'div',
					{ className: 'gh-row' },
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || full === '' || usable.length === 0, onClick: submit }, busy ? '提交中…' : ('提交 ' + usable.length + ' 个文件')),
					result === null ? null : h('a', { className: 'gh-link', href: result.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上查看这次提交'),
				),
			)
		}

		// ---- 协作面板：Issues / PR / 通知 ------------------------------------

		function ago(value) {
			return value === null || value === undefined ? '' : timeAgo(value)
		}

		function IssueRow({ issue, onOpen }) {
			return h(
				'button',
				{ type: 'button', className: 'gh-item', onClick: () => onOpen(issue.number) },
				h(
					'div',
					{ className: 'gh-item-head' },
					h('span', { className: 'gh-item-num' }, `#${issue.number}`),
					h('span', { className: 'gh-item-title' }, issue.title),
					issue.isPull ? h('span', { className: 'gh-tag', 'data-kind': 'track' }, 'PR') : null,
				),
				h(
					'div',
					{ className: 'gh-item-meta' },
					h('span', { className: 'gh-tag', 'data-kind': issue.state === 'open' ? 'star' : 'track' }, issue.state === 'open' ? '打开' : '已关闭'),
					issue.author === '' ? null : h('span', null, issue.author),
					issue.comments > 0 ? h('span', null, `${issue.comments} 评论`) : null,
					issue.labels.length > 0 ? h('span', null, issue.labels.join(' · ')) : null,
					h('span', { className: 'gh-item-at' }, ago(issue.updatedAt)),
				),
			)
		}

		function IssuePanel({ repos, initialFull }) {
			const [full, setFull] = useState(initialFull ?? '')
			const [state, setState] = useState('open')
			const [list, setList] = useState(null)
			const [error, setError] = useState(null)
			const [open, setOpen] = useState(null)
			const [detail, setDetail] = useState(null)
			const [comment, setComment] = useState('')
			const [busy, setBusy] = useState(false)
			const [creating, setCreating] = useState(false)
			const [draft, setDraft] = useState({ title: '', body: '' })
			const [manual, setManual] = useState(null)

			const load = useCallback((target, deep) => {
				if (target === '') return
				setError(null)
				setList(null)
				api(`/issues?full=${encodeURIComponent(target)}&state=${deep}&perPage=10`)
					.then((payload) => setList(payload.items ?? []))
					.catch((error_) => { setList([]); setError(error_.message) })
			}, [])

			useEffect(() => {
				if (full === '' && repos.length > 0) setFull(repos[0].full)
			}, [full, repos])

			useEffect(() => { if (full !== '') load(full, state) }, [full, state, load])

			const openIssue = useCallback((number) => {
				setOpen(number)
				setDetail(null)
				setComment('')
				api(`/issue?full=${encodeURIComponent(full)}&number=${number}`)
					.then(setDetail)
					.catch((error_) => setError(error_.message))
			}, [full])

			const send = useCallback(() => {
				const body = comment.trim()
				if (body === '' || open === null) return
				setBusy(true)
				api('/issue/comment', { method: 'POST', body: { full, number: open, body } })
					.then(() => { setComment(''); openIssue(open); load(full, state) })
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(false))
			}, [comment, full, open, openIssue, load, state])

			const toggle = useCallback((next) => {
				if (open === null) return
				setBusy(true)
				api('/issue/edit', { method: 'POST', body: { full, number: open, state: next } })
					.then(() => { openIssue(open); load(full, state) })
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(false))
			}, [full, open, openIssue, load, state])

			const create = useCallback(() => {
				const title = draft.title.trim()
				if (title === '') return
				setBusy(true)
				api('/issue', { method: 'POST', body: { full, title, body: draft.body } })
					.then(() => { setCreating(false); setDraft({ title: '', body: '' }); load(full, state) })
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(false))
			}, [draft, full, load, state])

			if (open !== null) {
				const issue = detail === null ? null : detail.issue
				const comments = detail === null ? [] : detail.comments ?? []
				return h(
					'div',
					{ className: 'gh-panel' },
					h(
						'div',
						{ className: 'gh-row' },
						h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => { setOpen(null); setDetail(null) } }, '← 返回列表'),
						issue === null ? null : h('span', { className: 'gh-hint' }, `${full} #${issue.number}`),
						issue === null ? null : h(
							'button',
							{ type: 'button', className: 'gh-btn', disabled: busy, onClick: () => toggle(issue.state === 'open' ? 'closed' : 'open') },
							issue.state === 'open' ? '关闭 issue' : '重新打开',
						),
						issue === null ? null : h('a', { className: 'gh-link', href: issue.htmlUrl, target: '_blank', rel: 'noreferrer', style: { marginLeft: 'auto' } }, '在 GitHub 上看'),
					),
					issue === null
						? h('div', { className: 'gh-state' }, '正在读取…')
						: h(
							'div',
							{ className: 'gh-card' },
							h('div', { className: 'gh-item-title', style: { fontSize: '14px', fontWeight: '650' } }, issue.title),
							h('div', { className: 'gh-item-meta' }, `${issue.author} 开于 ${ago(issue.createdAt)}`, issue.labels.length > 0 ? `· ${issue.labels.join(' · ')}` : ''),
							issue.body === '' ? null : h('div', { className: 'gh-body' }, issue.body),
						),
					h('div', { className: 'gh-label' }, `评论 ${comments.length} 条`),
					comments.length === 0 ? null : h(
						'div',
						{ className: 'gh-list' },
						comments.map((item) => h(
							'div',
							{ key: item.id, className: 'gh-card', style: { padding: '9px 11px' } },
							h('div', { className: 'gh-item-meta' }, `${item.author} · ${ago(item.createdAt)}`),
							h('div', { className: 'gh-body' }, item.body),
						)),
					),
					h(
						'div',
						{ className: 'gh-field' },
						h('textarea', {
							className: 'gh-textarea',
							style: { minHeight: '90px' },
							placeholder: '写一条评论…',
							value: comment,
							onChange: (event) => setComment(event.target.value),
						}),
						h(
							'div',
							{ className: 'gh-row' },
							h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || comment.trim() === '', onClick: send }, busy ? '发送中…' : '发表评论'),
						),
					),
				)
			}

			return h(
				'div',
				{ className: 'gh-panel' },
				h(
					'div',
					{ className: 'gh-row' },
					h('select', { className: 'gh-input', value: full, onChange: (event) => setFull(event.target.value) }, repos.map((repo) => h('option', { key: repo.full, value: repo.full }, repo.full))),
					h('select', { className: 'gh-input', value: state, onChange: (event) => setState(event.target.value) }, ['open', 'closed', 'all'].map((value) => h('option', { key: value, value }, value === 'open' ? '打开的' : value === 'closed' ? '已关闭' : '全部'))),
					h('button', { type: 'button', className: 'gh-btn', onClick: () => load(full, state) }, '刷新'),
					manual === null ? h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => setManual('') }, '填别的仓库') : h('input', {
						className: 'gh-input',
						style: { minWidth: '220px' },
						placeholder: 'owner/name，回车加载',
						value: manual,
						onChange: (event) => setManual(event.target.value),
						onKeyDown: (event) => { if (event.key === 'Enter' && manual.trim() !== '') { setFull(manual.trim()); load(manual.trim(), state) } },
					}),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', onClick: () => setCreating((value) => !value) }, creating ? '取消' : '新建 issue'),
				),
				creating ? h(
					'div',
					{ className: 'gh-sub-card' },
					h('input', { className: 'gh-input', placeholder: '标题', value: draft.title, onChange: (event) => setDraft({ ...draft, title: event.target.value }) }),
					h('textarea', { className: 'gh-textarea', style: { minHeight: '110px' }, placeholder: '正文（Markdown）', value: draft.body, onChange: (event) => setDraft({ ...draft, body: event.target.value }) }),
					h('div', { className: 'gh-row' }, h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || draft.title.trim() === '', onClick: create }, busy ? '创建中…' : '创建')),
				) : null,
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				list === null
					? h('div', { className: 'gh-state' }, '正在读取 issue…')
					: list.length === 0
						? h('div', { className: 'gh-state' }, '没有匹配的 issue')
						: h('div', { className: 'gh-list' }, list.map((issue) => h(IssueRow, { key: issue.number, issue, onOpen: openIssue }))),
			)
		}

		function DiffBlock({ file }) {
			if (file.patch === '') return h('div', { className: 'gh-hint' }, `${file.filename}：二进制或太大，没有 diff`)
			return h(
				'div',
				{ className: 'gh-diff' },
				h('div', { className: 'gh-diff-head' }, `${file.filename}  +${file.additions} −${file.deletions}`),
				h(
					'pre',
					{ className: 'gh-diff-body' },
					file.patch.split('\n').map((line, index) => h(
						'div',
						{
							key: index,
							className: 'gh-diff-line',
							'data-kind': line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith('@@') ? 'hunk' : 'ctx',
						},
						line === '' ? ' ' : line,
					)),
				),
			)
		}

		function PullPanel({ repos, initialFull }) {
			const [full, setFull] = useState(initialFull ?? '')
			const [state, setState] = useState('open')
			const [list, setList] = useState(null)
			const [error, setError] = useState(null)
			const [open, setOpen] = useState(null)
			const [detail, setDetail] = useState(null)
			const [busy, setBusy] = useState(false)
			const [note, setNote] = useState('')
			const [manual, setManual] = useState(null)

			const load = useCallback((target, deep) => {
				if (target === '') return
				setList(null)
				setError(null)
				api(`/pulls?full=${encodeURIComponent(target)}&state=${deep}&perPage=10`)
					.then((payload) => setList(payload.items ?? []))
					.catch((error_) => { setList([]); setError(error_.message) })
			}, [])

			useEffect(() => { if (full === '' && repos.length > 0) setFull(repos[0].full) }, [full, repos])
			useEffect(() => { if (full !== '') load(full, state) }, [full, state, load])

			const openPull = useCallback((number) => {
				setOpen(number)
				setDetail(null)
				setNote('')
				api(`/pull?full=${encodeURIComponent(full)}&number=${number}`)
					.then(setDetail)
					.catch((error_) => setError(error_.message))
			}, [full])

			const review = useCallback((event) => {
				if (open === null) return
				setBusy(true)
				api('/pull/review', { method: 'POST', body: { full, number: open, event, body: note } })
					.then(() => { setNote(''); openPull(open) })
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(false))
			}, [full, open, note, openPull])

			const merge = useCallback((method) => {
				if (open === null) return
				setBusy(true)
				api('/pull/merge', { method: 'POST', body: { full, number: open, method } })
					.then(() => { setOpen(null); setDetail(null); load(full, state) })
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(false))
			}, [full, open, load, state])

			if (open !== null) {
				const pull = detail === null ? null : detail.pull
				const files = detail === null ? [] : detail.files ?? []
				const comments = detail === null ? [] : detail.comments ?? []
				return h(
					'div',
					{ className: 'gh-panel' },
					h(
						'div',
						{ className: 'gh-row' },
						h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => { setOpen(null); setDetail(null) } }, '← 返回列表'),
						pull === null ? null : h('span', { className: 'gh-hint' }, `${pull.head} → ${pull.base} · ${files.length} 个文件`),
						pull === null ? null : h('a', { className: 'gh-link', href: pull.htmlUrl, target: '_blank', rel: 'noreferrer', style: { marginLeft: 'auto' } }, '在 GitHub 上看'),
					),
					pull === null
						? h('div', { className: 'gh-state' }, '正在读取…')
						: h(
							'div',
							{ className: 'gh-card' },
							h('div', { className: 'gh-item-title', style: { fontSize: '14px', fontWeight: '650' } }, pull.title),
							h('div', { className: 'gh-item-meta' }, `${pull.author} · +${pull.additions} −${pull.deletions}`, pull.draft ? '· draft' : '', pull.mergeable === false ? '· 有冲突' : ''),
							pull.body === '' ? null : h('div', { className: 'gh-body' }, pull.body),
							h(
								'div',
								{ className: 'gh-row' },
								h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || pull.merged, onClick: () => merge('merge') }, '合并'),
								h('button', { type: 'button', className: 'gh-btn', disabled: busy || pull.merged, onClick: () => merge('squash') }, 'Squash'),
								h('button', { type: 'button', className: 'gh-btn', disabled: busy || pull.merged, onClick: () => merge('rebase') }, 'Rebase'),
							),
						),
					error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
					h(
						'div',
						{ className: 'gh-field' },
						h('textarea', { className: 'gh-textarea', style: { minHeight: '80px' }, placeholder: '审核意见（可留空）', value: note, onChange: (event) => setNote(event.target.value) }),
						h(
							'div',
							{ className: 'gh-row' },
							h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy, onClick: () => review('APPROVE') }, '通过'),
							h('button', { type: 'button', className: 'gh-btn', disabled: busy, onClick: () => review('REQUEST_CHANGES') }, '要求修改'),
							h('button', { type: 'button', className: 'gh-btn', disabled: busy, onClick: () => review('COMMENT') }, '留言'),
						),
					),
					files.length === 0 ? null : h('div', { className: 'gh-label' }, `改动 ${files.length} 个文件`),
					files.map((file) => h(DiffBlock, { key: file.filename, file })),
					comments.length === 0 ? null : h('div', { className: 'gh-label' }, `评论 ${comments.length} 条`),
					comments.map((item) => h(
						'div',
						{ key: item.id, className: 'gh-card', style: { padding: '9px 11px' } },
						h('div', { className: 'gh-item-meta' }, `${item.author} · ${ago(item.createdAt)}`),
						h('div', { className: 'gh-body' }, item.body),
					)),
				)
			}

			return h(
				'div',
				{ className: 'gh-panel' },
				h(
					'div',
					{ className: 'gh-row' },
					h('select', { className: 'gh-input', value: full, onChange: (event) => setFull(event.target.value) }, repos.map((repo) => h('option', { key: repo.full, value: repo.full }, repo.full))),
					h('select', { className: 'gh-input', value: state, onChange: (event) => setState(event.target.value) }, ['open', 'closed', 'all'].map((value) => h('option', { key: value, value }, value === 'open' ? '打开的' : value === 'closed' ? '已合并/关闭' : '全部'))),
					h('button', { type: 'button', className: 'gh-btn', onClick: () => load(full, state) }, '刷新'),
					manual === null ? h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => setManual('') }, '填别的仓库') : h('input', {
						className: 'gh-input',
						style: { minWidth: '220px' },
						placeholder: 'owner/name，回车加载',
						value: manual,
						onChange: (event) => setManual(event.target.value),
						onKeyDown: (event) => { if (event.key === 'Enter' && manual.trim() !== '') { setFull(manual.trim()); load(manual.trim(), state) } },
					}),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				list === null
					? h('div', { className: 'gh-state' }, '正在读取 PR…')
					: list.length === 0
						? h('div', { className: 'gh-state' }, '没有匹配的 PR')
						: h('div', { className: 'gh-list' }, list.map((pull) => h(
							'button',
							{ key: pull.number, type: 'button', className: 'gh-item', onClick: () => openPull(pull.number) },
							h(
								'div',
								{ className: 'gh-item-head' },
								h('span', { className: 'gh-item-num' }, `#${pull.number}`),
								h('span', { className: 'gh-item-title' }, pull.title),
								pull.draft ? h('span', { className: 'gh-tag' }, 'draft') : null,
								pull.mergeable === false ? h('span', { className: 'gh-tag', 'data-kind': 'track' }, '冲突') : null,
							),
							h(
								'div',
								{ className: 'gh-item-meta' },
								h('span', null, `${pull.head} → ${pull.base}`),
								h('span', null, pull.author),
								h('span', null, `+${pull.additions} −${pull.deletions}`),
								h('span', { className: 'gh-item-at' }, ago(pull.updatedAt)),
							),
						)))
			)
		}

		function NotifyPanel() {
			const [data, setData] = useState(null)
			const [error, setError] = useState(null)
			const [busy, setBusy] = useState(null)

			const load = useCallback(() => {
				setData(null)
				setError(null)
				api('/notifications')
					.then(setData)
					.catch((error_) => { setData({ items: [] }); setError(error_.message) })
			}, [])

			useEffect(() => { load() }, [load])

			const markRead = useCallback((id) => {
				setBusy(id)
				api('/notifications/read', { method: 'POST', body: { id } })
					.then(() => setData((previous) => previous === null ? previous : { ...previous, items: previous.items.filter((item) => item.id !== id) }))
					.catch((error_) => setError(error_.message))
					.finally(() => setBusy(null))
			}, [])

			return h(
				'div',
				{ className: 'gh-panel' },
				h(
					'div',
					{ className: 'gh-row' },
					h('button', { type: 'button', className: 'gh-btn', onClick: load }, '刷新'),
					data === null ? null : h('span', { className: 'gh-hint' }, `${data.unread ?? 0} 条未读`),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				data === null
					? h('div', { className: 'gh-state' }, '正在读取通知…')
					: (data.items ?? []).length === 0
						? h('div', { className: 'gh-state' }, '没有未读通知')
						: h('div', { className: 'gh-list' }, data.items.map((item) => h(
							'div',
							{ key: item.id, className: 'gh-item', style: { cursor: 'default' } },
							h(
								'div',
								{ className: 'gh-item-head' },
								h('span', { className: 'gh-tag', 'data-kind': 'star' }, item.reason),
								h('span', { className: 'gh-item-title' }, item.title),
							),
							h(
								'div',
								{ className: 'gh-item-meta' },
								h('span', null, item.repo),
								h('span', null, item.type),
								h('span', { className: 'gh-item-at' }, ago(item.updatedAt)),
								h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', disabled: busy === item.id, onClick: () => markRead(item.id) }, '标记已读'),
							),
						)))
			)
		}

		/**
		 * 设备流登录：拿 6 位码 → 用户在浏览器授权 → 这里轮询换 Token。
		 * 比粘贴 PAT 友好得多，这也是 dsh-github-connect 那批插件最受欢迎的入口。
		 */
		function DeviceLogin({ onConnected }) {
			const [flow, setFlow] = useState(null)
			const [phase, setPhase] = useState('idle')
			const [error, setError] = useState(null)
			const timer = useRef(null)

			const stop = useCallback(() => {
				if (timer.current !== null) {
					clearTimeout(timer.current)
					timer.current = null
				}
			}, [])

			useEffect(() => stop, [stop])

			const poll = useCallback((deviceCode, interval) => {
				stop()
				timer.current = setTimeout(() => {
					api('/device/poll', { method: 'POST', body: { deviceCode } })
						.then((payload) => {
							if (payload.status === 'ok') {
								setPhase('done')
								if (typeof onConnected === 'function') onConnected(payload)
								return
							}
							if (payload.status === 'denied') {
								setPhase('error')
								setError('你在浏览器里点了拒绝')
								return
							}
							if (payload.status === 'expired') {
								setPhase('error')
								setError('码过期了，重新来一次')
								return
							}
							const next = payload.status === 'slow' && Number.isFinite(payload.interval) ? payload.interval : interval
							poll(deviceCode, next)
						})
						.catch((cause) => {
							setPhase('error')
							setError(cause instanceof Error ? cause.message : String(cause))
						})
				}, Math.max(3, interval) * 1000)
			}, [onConnected, stop])

			const begin = useCallback(() => {
				setPhase('loading')
				setError(null)
				api('/device/start', { method: 'POST', body: {} })
					.then((payload) => {
						setFlow(payload)
						setPhase('waiting')
						poll(payload.deviceCode, payload.interval ?? 5)
					})
					.catch((cause) => {
						setPhase('error')
						setError(cause instanceof Error ? cause.message : String(cause))
					})
			}, [poll])

			if (phase === 'idle' || phase === 'error') {
				return h(
					'div',
					{ className: 'gh-device' },
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', onClick: begin }, '用浏览器授权（设备流）'),
					h('span', { className: 'gh-hint' }, '不用去创建 Token，输入 6 位码就行'),
					error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				)
			}

			return h(
				'div',
				{ className: 'gh-device' },
				h('div', { className: 'gh-device-label' }, '在浏览器里打开 github.com/login/device，输入这个码：'),
				h('div', { className: 'gh-device-code' }, flow === null ? '……' : flow.userCode),
				h(
					'div',
					{ className: 'gh-row' },
					flow === null ? null : h('a', { className: 'gh-btn', 'data-kind': 'primary', href: flow.verifyUrl, target: '_blank', rel: 'noreferrer' }, '打开授权页'),
					h('span', { className: 'gh-hint' }, phase === 'waiting' ? '正在等你授权…' : phase === 'done' ? '已连接' : '准备中…'),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => { stop(); setPhase('idle'); setFlow(null) } }, '取消'),
				),
			)
		}

		function statusKind(run) {
			const conclusion = typeof run.conclusion === 'string' ? run.conclusion : ''
			if (run.status !== 'completed') return 'running'
			if (conclusion === 'success') return 'ok'
			if (conclusion === 'failure' || conclusion === 'timed_out') return 'bad'
			if (conclusion === 'cancelled' || conclusion === 'skipped') return 'flat'
			return 'flat'
		}

		function statusText(run) {
			if (run.status !== 'completed') return run.status === 'queued' ? '排队中' : '运行中'
			if (run.conclusion === 'success') return '成功'
			if (run.conclusion === 'failure') return '失败'
			if (run.conclusion === 'cancelled') return '已取消'
			if (run.conclusion === 'skipped') return '已跳过'
			return run.conclusion === '' ? '—' : run.conclusion
		}

		/** Actions：列 workflow run、看 job/步骤、重跑、取消。 */
		/** Actions：列 workflow run、看 job/步骤、重跑、取消、拉原始日志。 */
		function ActionPanel({ repos, initialFull }) {
			const [full, setFull] = useState(initialFull !== undefined ? initialFull : (repos[0] === undefined ? '' : repos[0].full))
			const [manual, setManual] = useState(null)
			const [data, setData] = useState(null)
			const [error, setError] = useState(null)
			const [busy, setBusy] = useState(null)
			const [openRun, setOpenRun] = useState(null)
			const [jobs, setJobs] = useState(null)
			const [logs, setLogs] = useState(null)

			const loadLogs = useCallback((run, jobId) => {
				setLogs({ loading: true, text: '' })
				const suffix = jobId === undefined ? '' : '&job=' + jobId
				api('/actions/logs?full=' + encodeURIComponent(full) + '&id=' + run.id + suffix, { timeoutMs: 180_000 })
					.then((payload) => setLogs({ loading: false, text: payload.text, truncated: payload.truncated === true }))
					.catch((cause) => setLogs({ loading: false, text: '', error: cause.message }))
			}, [full])

			const load = useCallback((target) => {
				if (typeof target !== 'string' || target === '') return
				setData(null)
				setError(null)
				api('/actions?full=' + encodeURIComponent(target) + '&perPage=20')
					.then(setData)
					.catch((cause) => { setData({ items: [] }); setError(cause.message) })
			}, [])

			useEffect(() => { load(full) }, [full, load])

			const act = useCallback((run, action) => {
				setBusy(run.id + ':' + action)
				api('/actions/' + action, { method: 'POST', body: { full, id: run.id } })
					.then(() => load(full))
					.catch((cause) => setError(cause.message))
					.finally(() => setBusy(null))
			}, [full, load])

			const inspect = useCallback((run) => {
				if (openRun === run.id) {
					setOpenRun(null)
					setJobs(null)
					setLogs(null)
					return
				}
				setOpenRun(run.id)
				setJobs(null)
				setLogs(null)
				api('/actions/jobs?full=' + encodeURIComponent(full) + '&id=' + run.id)
					.then(setJobs)
					.catch((cause) => setError(cause.message))
			}, [full, openRun])

			const rows = data === null ? [] : data.items ?? []

			const head = h(
				'div',
				{ className: 'gh-row' },
				h(
					'select',
					{ className: 'gh-select', value: full, onChange: (event) => { setFull(event.target.value); setManual(null) } },
					repos.map((repo) => h('option', { key: repo.full, value: repo.full }, repo.full)),
				),
				manual === null
					? h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => setManual('') }, '填别的仓库')
					: h('input', {
						className: 'gh-input',
						placeholder: 'owner/name，回车加载',
						value: manual,
						autoFocus: true,
						onChange: (event) => setManual(event.target.value),
						onKeyDown: (event) => {
							if (event.key === 'Enter' && manual.trim() !== '') {
								setFull(manual.trim())
								load(manual.trim())
							}
						},
					}),
				h('button', { type: 'button', className: 'gh-btn', onClick: () => load(full) }, '刷新'),
				data === null ? null : h('span', { className: 'gh-hint' }, data.total + ' 次运行'),
			)

			const jobsBlock = (run) => {
				if (openRun !== run.id) return null
				const list = jobs === null ? null : jobs.items ?? []
				return h(
					'div',
					{ className: 'gh-jobs' },
					list === null
						? h('div', { className: 'gh-state' }, '读取 job…')
						: list.map((job) => h(
							'div',
							{ key: job.id, className: 'gh-job' },
							h(
								'div',
								{ className: 'gh-job-head' },
								h('span', { className: 'gh-run-dot', 'data-kind': job.conclusion === 'success' ? 'ok' : job.conclusion === 'failure' ? 'bad' : 'flat' }),
								h('span', { className: 'gh-job-name' }, job.name),
								h('span', { className: 'gh-run-meta' }, statusText({ status: job.status, conclusion: job.conclusion })),
							),
							h(
								'div',
								{ className: 'gh-steps' },
								(job.steps ?? []).map((step) => h(
									'div',
									{ key: step.number, className: 'gh-step', 'data-kind': step.conclusion === 'success' ? 'ok' : step.conclusion === 'failure' ? 'bad' : 'flat' },
									h('span', { className: 'gh-step-num' }, step.number),
									h('span', null, step.name),
									h('span', { className: 'gh-step-state' }, step.conclusion === '' ? (step.status === 'in_progress' ? '进行中' : '等待') : statusText({ status: 'completed', conclusion: step.conclusion })),
								)),
							),
						)),
					logsBlock(run),
				)
			}

			const logsBlock = (run) => h(
				'div',
				{ className: 'gh-logs' },
				h(
					'div',
					{ className: 'gh-row' },
					h('span', { className: 'gh-label' }, '原始日志'),
					h('button', {
						type: 'button',
						className: 'gh-btn',
						'data-kind': 'ghost',
						disabled: logs !== null && logs.loading === true,
						onClick: () => loadLogs(run),
					}, logs === null ? '读取全部 job 日志' : '重新读取'),
					logs === null || logs.loading !== true ? null : h('span', { className: 'gh-hint' }, '正在拉日志包…'),
					logs === null || logs.truncated !== true ? null : h('span', { className: 'gh-hint' }, '已截断'),
				),
				logs === null
					? h('div', { className: 'gh-hint' }, '点上面的按钮，把这次运行的 job 日志包解开看原文。')
					: logs.error !== undefined
						? h('div', { className: 'gh-note', 'data-kind': 'error' }, logs.error)
						: h('pre', { className: 'gh-log-pre' }, logs.loading === true ? '…' : logs.text),
			)

			const runRow = (run) => h(
				'div',
				{ key: run.id, className: 'gh-run', 'data-kind': statusKind(run) },
				h(
					'div',
					{ className: 'gh-run-main' },
					h('span', { className: 'gh-run-dot', 'data-kind': statusKind(run) }),
					h('button', { type: 'button', className: 'gh-run-title', onClick: () => inspect(run) }, '#' + run.runNumber + ' ' + (run.title === '' ? run.name : run.title)),
					h('span', { className: 'gh-run-status', 'data-kind': statusKind(run) }, statusText(run)),
					h('span', { className: 'gh-run-meta' }, run.branch + ' · ' + run.sha + ' · ' + run.event + ' · ' + ago(run.createdAt)),
					h(
						'div',
						{ className: 'gh-run-actions' },
						h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', disabled: busy === run.id + ':rerun', onClick: () => act(run, 'rerun') }, '重跑'),
						h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', disabled: busy === run.id + ':cancel' || run.status === 'completed', onClick: () => act(run, 'cancel') }, '取消'),
						run.url === '' ? null : h('a', { className: 'gh-link', href: run.url, target: '_blank', rel: 'noreferrer' }, '打开'),
					),
				),
				jobsBlock(run),
			)

			const listBlock = data === null
				? h('div', { className: 'gh-state' }, '正在读取 Actions…')
				: rows.length === 0
					? h('div', { className: 'gh-state' }, '这个仓库还没有 workflow 运行')
					: h('div', { className: 'gh-list' }, rows.map(runRow))

			return h(
				'div',
				{ className: 'gh-panel' },
				head,
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				listBlock,
			)
		}


		/** 把扁平的文件路径折成目录树，目录排在文件前面。 */
		function buildTree(items) {
			const root = { dirs: new Map(), files: [] }
			for (const entry of items) {
				const segments = String(entry.path).split('/')
				let node = root
				for (let index = 0; index < segments.length - 1; index += 1) {
					const name = segments[index]
					if (!node.dirs.has(name)) node.dirs.set(name, { dirs: new Map(), files: [] })
					node = node.dirs.get(name)
				}
				node.files.push({ name: segments[segments.length - 1], path: entry.path, size: entry.size })
			}
			return root
		}

		/** 折叠成扁平行（按当前展开状态），一次 map 就出整棵树。 */
		function flattenTree(root, openPaths) {
			return flattenInto(root, openPaths, 0, '', [])
		}

		function flattenInto(root, openPaths, depth, prefix, out) {
			const dirNames = [...root.dirs.keys()].sort((left, right) => left.localeCompare(right))
			const files = [...root.files].sort((left, right) => left.name.localeCompare(right.name))
			for (const name of dirNames) {
				const path = prefix === '' ? name : prefix + '/' + name
				const child = root.dirs.get(name)
				const open = openPaths[path] !== true
				out.push({ kind: 'dir', name, path, depth, open, count: child.files.length + child.dirs.size })
				if (open) flattenInto(child, openPaths, depth + 1, path, out)
			}
			for (const file of files) {
				out.push({ kind: 'file', name: file.name, path: file.path, size: file.size, depth })
			}
			return out
		}

		function fileSizeLabel(size) {
			if (!Number.isFinite(size)) return ''
			if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB'
			if (size >= 1024) return Math.round(size / 1024) + ' KB'
			return size + ' B'
		}

		/** 一行的渲染：目录带折叠箭头与图标，文件带扩展名图标。 */
		function TreeRow({ row, onToggle, onOpenFile }) {
			const isDir = row.kind === 'dir'
			return h(
				'button',
				{
					type: 'button',
					className: 'gh-tree-item',
					title: row.path,
					'data-dir': isDir ? '1' : '0',
					style: { paddingLeft: 8 + row.depth * 14 + 'px' },
					onClick: isDir ? () => onToggle(row.path) : () => onOpenFile(row.path),
				},
				h('span', { className: 'gh-tree-caret', 'data-open': isDir && row.open ? '1' : '0' }, isDir ? '▶' : ''),
				h('span', { className: 'gh-tree-icon' }, isDir ? (row.open ? '📂' : '📁') : '📄'),
				h('span', { className: 'gh-tree-name', 'data-dir': isDir ? '1' : '0' }, isDir ? row.name + '/' : row.name),
				h('span', { className: 'gh-tree-size' }, isDir ? row.count + ' 项' : fileSizeLabel(row.size)),
			)
		}

				/** 代码浏览：先拿整个文件树，再按文件看内容（带行号）。 */
		function CodePanel({ repos, initialFull }) {
			const [picked, setPicked] = useState(initialFull !== undefined ? initialFull : '')
			const full = picked !== '' ? picked : (repos[0] === undefined ? '' : repos[0].full)
			const setFull = setPicked
			const [tree, setTree] = useState(null)
			const [error, setError] = useState(null)
			const [query, setQuery] = useState('')
			const [file, setFile] = useState(null)
			const [loadingFile, setLoadingFile] = useState(false)
			const [expandTick, setExpandTick] = useState(0)
			const closedRef = useRef({})

			const loadTree = useCallback((target) => {
				if (typeof target !== 'string' || target === '') return
				setTree(null)
				setError(null)
				setFile(null)
				api('/tree?full=' + encodeURIComponent(target))
					.then(setTree)
					.catch((cause) => { setTree({ items: [] }); setError(cause.message) })
			}, [])

			useEffect(() => { loadTree(full) }, [full, loadTree])

			const openFile = useCallback((path) => {
				setLoadingFile(true)
				setError(null)
				api('/contents?full=' + encodeURIComponent(full) + '&path=' + encodeURIComponent(path))
					.then(setFile)
					.catch((cause) => setError(cause.message))
					.finally(() => setLoadingFile(false))
			}, [full])

			const items = tree === null ? [] : tree.items ?? []
			const needle = query.trim().toLowerCase()
			const shown = (needle === '' ? items : items.filter((entry) => entry.path.toLowerCase().includes(needle))).slice(0, 300)
			const rows = flattenTree(buildTree(shown), closedRef.current)
			const toggleDir = useCallback((path) => {
				closedRef.current = { ...closedRef.current, [path]: closedRef.current[path] !== true }
				setExpandTick(expandTick + 1)
			}, [expandTick, setExpandTick])
			const lines = file === null || typeof file.text !== 'string' ? [] : file.text.split('\n')

			return h(
				'div',
				{ className: 'gh-panel' },
				h(
					'div',
					{ className: 'gh-row' },
					h(
						'select',
						{ className: 'gh-select', value: full, onChange: (event) => setFull(event.target.value) },
						repos.map((repo) => h('option', { key: repo.full, value: repo.full }, repo.full)),
					),
					h('input', { className: 'gh-input', placeholder: '按路径筛选，如 src/', value: query, onChange: (event) => setQuery(event.target.value) }),
					h('button', { type: 'button', className: 'gh-btn', onClick: () => loadTree(full) }, '刷新'),
					tree === null ? null : h('span', { className: 'gh-hint' }, (tree.ref === undefined || tree.ref === '' ? '默认分支' : tree.ref) + ' · ' + (tree.count === undefined ? items.length : tree.count) + ' 个文件 · ' + items.filter((entry) => entry.path.includes('/')).length + ' 个目录'),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
				file === null
					? tree === null
						? h('div', { className: 'gh-state' }, '正在读取文件树…')
						: shown.length === 0
							? h('div', { className: 'gh-state' }, needle === '' ? '这个仓库没有文件' : '没有匹配的路径')
							: h('div', { className: 'gh-tree' }, rows.map((row) => h(TreeRow, { key: row.path, row, onToggle: toggleDir, onOpenFile: openFile })))
					: h(
						'div',
						{ className: 'gh-file' },
						h(
							'div',
							{ className: 'gh-crumb' },
							h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: () => setFile(null) }, '← 文件列表'),
							h('span', { className: 'gh-crumb-path' }, file.path),
							h('span', { className: 'gh-crumb-size' }, '· ' + (file.size >= 1024 ? Math.round(file.size / 1024) + ' KB' : file.size + ' B')),
							file.url === '' ? null : h('a', { className: 'gh-link', href: file.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 打开'),
						),
						file.binary
							? h('div', { className: 'gh-state' }, '这是二进制文件，这里不显示内容')
							: file.truncated || file.text === null
								? h('div', { className: 'gh-state' }, '文件太大（超过 1 MB），请到 GitHub 上看')
								: h(
									'div',
									{ className: 'gh-code' },
									lines.map((line, index) => h(
										'div',
										{ key: index, className: 'gh-code-line' },
										h('span', { className: 'gh-code-num' }, index + 1),
										h('span', { className: 'gh-code-text' }, line === '' ? ' ' : line),
								)),
						),
					),
				loadingFile ? h('div', { className: 'gh-hint' }, '读取文件…') : null,
			)
		}

		/** Star 日报：把 /report 生成的 Markdown 复制走，或直接看预览。 */
		function ReportBox() {
			const [report, setReport] = useState(null)
			const [copied, setCopied] = useState(false)

			const load = useCallback(() => {
				api('/report').then(setReport).catch(() => setReport(null))
			}, [])

			useEffect(() => { load() }, [load])

			const copy = useCallback(() => {
				if (report === null) return
				const text = report.markdown
				const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600) }
				if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
					navigator.clipboard.writeText(text).then(done, () => setCopied(false))
				}
			}, [report])

			if (report === null) return null
			return h(
				'div',
				{ className: 'gh-report' },
				h(
					'div',
					{ className: 'gh-row' },
					h('span', { className: 'gh-title' }, 'Star 日报'),
					h('span', { className: 'gh-hint' }, '可以直接贴到 issue 或 README 里'),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', onClick: copy, style: { marginLeft: 'auto' } }, copied ? '已复制' : '复制 Markdown'),
				),
				h('pre', { className: 'gh-report-pre' }, report.markdown),
			)
		}

		/** 发布 Release：tag + 标题 + 说明，一步发到 GitHub。 */
		function ReleaseForm({ repos, onDone }) {
			const [full, setFull] = useState(repos[0] === undefined ? '' : repos[0].full)
			const [tag, setTag] = useState('')
			const [name, setName] = useState('')
			const [body, setBody] = useState('')
			const [prerelease, setPrerelease] = useState(false)
			const [busy, setBusy] = useState(false)
			const [error, setError] = useState(null)

			const submit = useCallback(() => {
				if (tag.trim() === '' || busy) return
				setBusy(true)
				setError(null)
				api('/release', { method: 'POST', body: { full, tag: tag.trim(), name: name.trim() === '' ? tag.trim() : name.trim(), body, prerelease } })
					.then((payload) => {
						setTag('')
						setName('')
						setBody('')
						if (typeof onDone === 'function') onDone(payload)
					})
					.catch((cause) => setError(cause.message))
					.finally(() => setBusy(false))
			}, [full, tag, name, body, prerelease, busy, onDone])

			return h(
				'div',
				{ className: 'gh-sub-card' },
				h(
					'div',
					{ className: 'gh-row' },
					h('span', { className: 'gh-title' }, '发布 Release'),
					h('span', { className: 'gh-hint' }, '打一个 tag，写清这次改了什么'),
				),
				h(
					'div',
					{ className: 'gh-row' },
					h('select', { className: 'gh-select', value: full, onChange: (event) => setFull(event.target.value) }, repos.map((repo) => h('option', { key: repo.full, value: repo.full }, repo.full))),
					h('input', { className: 'gh-input', placeholder: 'v1.0.0', value: tag, onChange: (event) => setTag(event.target.value) }),
					h('input', { className: 'gh-input', placeholder: '标题（默认同 tag）', value: name, onChange: (event) => setName(event.target.value) }),
				),
				h('textarea', { className: 'gh-textarea', rows: 3, placeholder: '这次发布了什么…', value: body, onChange: (event) => setBody(event.target.value) }),
				h(
					'div',
					{ className: 'gh-row' },
					h(
						'label',
						{ className: 'gh-check' },
						h('input', { type: 'checkbox', checked: prerelease, onChange: (event) => setPrerelease(event.target.checked) }),
						'预发布',
					),
					h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'primary', disabled: busy || tag.trim() === '', onClick: submit }, busy ? '发布中…' : '发布'),
				),
				error === null ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
			)
		}

		function dayKey(date) {
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			return `${year}-${month}-${day}`
		}

		function StatCard({ label, value, hint, kind }) {
			return h(
				'div',
				{ className: 'gh-stat', 'data-kind': kind ?? 'plain' },
				h('div', { className: 'gh-stat-label' }, label),
				h('div', { className: 'gh-stat-value' }, value),
				hint === undefined || hint === null ? null : h('div', { className: 'gh-stat-hint' }, hint),
			)
		}

		/** 把 [{d,n}] 摊成连续日期的格子，中间空的日子补 0。 */
		function buildCalendar(points, weeks) {
			const byDay = new Map()
			for (const point of points) byDay.set(point.d, (byDay.get(point.d) ?? 0) + point.n)
			const today = new Date()
			today.setHours(0, 0, 0, 0)
			const span = (weeks - 1) * 7 + ((today.getDay() + 6) % 7) + 1
			const cells = []
			for (let offset = span - 1; offset >= 0; offset -= 1) {
				const date = new Date(today.getTime() - offset * 86400000)
				const key = dayKey(date)
				cells.push({ d: key, n: byDay.get(key) ?? 0, date })
			}
			const columns = []
			for (let index = 0; index < cells.length; index += 7) columns.push(cells.slice(index, index + 7))
			const peak = cells.reduce((max, cell) => (cell.n > max ? cell.n : max), 0)
			const labels = columns.map((column, index) => {
				const first = column[0]
				if (first === undefined) return ''
				const month = first.date.getMonth() + 1
				if (index === 0) return month + ' 月'
				const previous = columns[index - 1][0]
				return previous !== undefined && previous.date.getMonth() !== first.date.getMonth() ? month + ' 月' : ''
			})
			let streak = 0
			for (let index = cells.length - 1; index >= 0; index -= 1) {
				if (cells[index].n > 0) streak += 1
				else if (streak > 0 || index < cells.length - 1) break
			}
			const last7 = cells.slice(-7).reduce((sum, cell) => sum + cell.n, 0)
			const last30 = cells.slice(-30).reduce((sum, cell) => sum + cell.n, 0)
			return { columns, labels, peak, total: cells.reduce((sum, cell) => sum + cell.n, 0), streak, last7, last30 }
		}

		function Heatmap({ points, weeks = 26 }) {
			const calendar = useMemo(() => buildCalendar(points ?? [], weeks), [points, weeks])
			const level = (count) => {
				if (count === 0) return 0
				if (calendar.peak <= 1) return 3
				const ratio = count / calendar.peak
				if (ratio > 0.75) return 4
				if (ratio > 0.5) return 3
				if (ratio > 0.25) return 2
				return 1
			}
			return h(
				'div',
				{ className: 'gh-heat' },
				h(
					'div',
					{ className: 'gh-heat-months' },
					calendar.labels.map((label, index) => h('span', { className: 'gh-heat-month', key: index }, label)),
				),
				h(
					'div',
					{ className: 'gh-heat-grid' },
					calendar.columns.map((column, columnIndex) => h(
						'div',
						{ className: 'gh-heat-col', key: columnIndex },
						column.map((cell) => h('span', {
							key: cell.d,
							className: 'gh-heat-cell',
							'data-level': String(level(cell.n)),
							title: `${cell.d} · ${cell.n} 次活动`,
						})),
					)),
				),
				h(
					'div',
					{ className: 'gh-heat-foot' },
					h('span', null, `最近 ${weeks} 周 · 共 ${calendar.total} 次活动`),
					h('span', { className: 'gh-heat-side' }, `近 7 天 ${calendar.last7} 次 · 近 30 天 ${calendar.last30} 次` + (calendar.streak > 0 ? ` · 连续 ${calendar.streak} 天` : '')),
				),
			)
		}

		function BigChart({ points, height = 120 }) {
			if (!Array.isArray(points) || points.length < 2) {
				return h('div', { className: 'gh-state', style: { padding: '26px 12px' } }, '还没有足够的 star 历史，去「Star」里记录几次就有了')
			}
			const width = 640
			const values = points.map((point) => point.s)
			const min = Math.min(...values)
			const max = Math.max(...values)
			const span = max - min === 0 ? 1 : max - min
			const step = width / (points.length - 1)
			const y = (value) => height - ((value - min) / span) * (height - 18) - 9
			const coords = points.map((point, index) => `${(index * step).toFixed(1)},${y(point.s).toFixed(1)}`)
			const area = `0,${height} ${coords.join(' ')} ${width},${height}`
			const grid = [0.25, 0.5, 0.75].map((fraction) => h('line', {
				key: 'grid' + fraction,
				x1: '0',
				y1: (height * fraction).toFixed(1),
				x2: String(width),
				y2: (height * fraction).toFixed(1),
				stroke: 'var(--dsw-alias-border-l1)',
				'stroke-width': '1',
				'vector-effect': 'non-scaling-stroke',
			}))
			return h(
				'div',
				{ className: 'gh-chart' },
				h(
					'svg',
					{ viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', className: 'gh-chart-svg', 'aria-hidden': 'true' },
					h('defs', null,
					h('linearGradient', { id: 'ghArea', x1: '0', y1: '0', x2: '0', y2: '1' },
						h('stop', { offset: '0%', 'stop-color': '#7c6cf5', 'stop-opacity': '0.36' }),
						h('stop', { offset: '100%', 'stop-color': '#7c6cf5', 'stop-opacity': '0.02' }),
					),
					h('linearGradient', { id: 'ghStroke', x1: '0', y1: '0', x2: '1', y2: '0' },
						h('stop', { offset: '0%', 'stop-color': '#7c6cf5' }),
						h('stop', { offset: '100%', 'stop-color': '#3b82f6' }),
					),
				),
				...grid,
					h('polygon', { points: area, fill: 'url(#ghArea)' }),
					h('polyline', {
						points: coords.join(' '),
						fill: 'none',
						stroke: 'url(#ghStroke)',
						'stroke-width': '2',
						'stroke-linecap': 'round',
						'stroke-linejoin': 'round',
						'vector-effect': 'non-scaling-stroke',
					}),
				),
				h(
					'div',
					{ className: 'gh-chart-foot' },
					h('span', null, points[0].d),
					h('span', null, `${points[points.length - 1].s} star`),
					h('span', null, points[points.length - 1].d),
				),
			)
		}

		function Dashboard({ overview, loading, error, onReload }) {
			if (loading) return h('div', { className: 'gh-state' }, '正在汇总…')
			if (error !== null && error !== undefined) {
				return h(
					'div',
					{ className: 'gh-card' },
					h('div', { className: 'gh-note', 'data-kind': 'error' }, error),
					h('button', { type: 'button', className: 'gh-btn', onClick: onReload }, '重试'),
				)
			}
			if (overview === null) return h('div', { className: 'gh-state' }, '还没有数据')
			const languages = overview.languages ?? []
			const totalLangRepos = languages.reduce((sum, item) => sum + item.count, 0) || 1
			let cursor = 0
			const donut = 'conic-gradient(' + languages.map((item, index) => {
				const share = (item.ratio ?? item.count / totalLangRepos) * 100
				const stop = LANG_COLORS[index % LANG_COLORS.length] + ' ' + cursor.toFixed(2) + '% ' + (cursor + share).toFixed(2) + '%'
				cursor += share
				return stop
			}).join(',') + ')'
			return h(
				'div',
				{ className: 'gh-dash' },
				h(
					'div',
					{ className: 'gh-stats' },
					h(StatCard, { label: '仓库', value: formatCount(overview.repos), hint: `记录中 ${overview.tracked} 个`, kind: 'repos' }),
					h(StatCard, { label: '总 star', value: formatCount(overview.totalStars), hint: '全部仓库合计', kind: 'stars' }),
					h(StatCard, { label: '总 fork', value: formatCount(overview.totalForks), hint: '别人 fork 出去的次数', kind: 'forks' }),
					h(StatCard, { label: '待办', value: String(overview.totalIssues), hint: 'open issue 合计', kind: 'issues' }),
					h(StatCard, { label: '未读', value: String(overview.unread), hint: 'GitHub 通知', kind: 'unread' }),
				),
				h(
					'div',
					{ className: 'gh-card' },
					h(
						'div',
						{ className: 'gh-row' },
						h('div', { className: 'gh-title' }, 'star 走势'),
						h('span', { className: 'gh-hint' }, '被记录的仓库合计'),
						h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'ghost', style: { marginLeft: 'auto' }, onClick: onReload, disabled: loading === true }, '刷新'),
					),
					h(BigChart, { points: overview.total ?? [] }),
				),
				h(
					'div',
					{ className: 'gh-split' },
					h(
						'div',
						{ className: 'gh-card' },
						h('div', { className: 'gh-title' }, '活动热度'),
						h(Heatmap, { points: overview.activity ?? [], weeks: 26 }),
					),
					h(
						'div',
						{ className: 'gh-card' },
						h('div', { className: 'gh-title' }, '语言构成'),
						languages.length === 0
							? h('div', { className: 'gh-state', style: { padding: '18px 0' } }, '还没有语言信息')
							: h(
								'div',
								{ className: 'gh-langwrap' },
								h(
									'div',
									{ className: 'gh-donut', style: { background: donut } },
									h('div', { className: 'gh-donut-label' }, h('b', null, String(totalLangRepos)), h('span', null, '个仓库')),
								),
								h(
									'div',
									{ className: 'gh-legend' },
									languages.map((item, index) => h(
										'div',
										{ className: 'gh-legend-row', key: item.language },
										h('span', { className: 'gh-dot', style: { background: LANG_COLORS[index % LANG_COLORS.length] } }),
										h('span', { className: 'gh-legend-name' }, item.language),
										h('span', { className: 'gh-legend-num' }, String(item.count) + ' · ' + Math.round((item.ratio ?? item.count / totalLangRepos) * 100) + '%'),
									)),
								),
							),
					),
				),
				h(
					'div',
					{ className: 'gh-split' },
					h(
						'div',
						{ className: 'gh-card' },
						h('div', { className: 'gh-title' }, 'star 最多'),
						(overview.topRepos ?? []).length === 0
							? h('div', { className: 'gh-state', style: { padding: '18px 0' } }, '没有仓库')
							: h('div', { className: 'gh-bars' }, (overview.topRepos ?? []).map((repo) => {
								const peak = (overview.topRepos[0]?.stars ?? 1) || 1
								return h(
									'div',
									{ className: 'gh-bar', key: repo.full },
									h('span', { className: 'gh-bar-name', title: repo.full }, repo.name),
									h('span', { className: 'gh-bar-track' }, h('span', { className: 'gh-bar-fill', style: { width: `${Math.max(4, Math.round((repo.stars / peak) * 100))}%` } })),
									h('span', { className: 'gh-bar-num' }, formatCount(repo.stars)),
								)
							})),
					),
					h(
						'div',
						{ className: 'gh-card' },
						h('div', { className: 'gh-title' }, '最近有动作'),
						(overview.recent ?? []).length === 0
							? h('div', { className: 'gh-state', style: { padding: '18px 0' } }, '还没有推送记录')
							: h('div', { className: 'gh-list' }, (overview.recent ?? []).map((repo) => h(
								'a',
								{ className: 'gh-recent', key: repo.full, href: repo.htmlUrl, target: '_blank', rel: 'noreferrer' },
								h('span', { className: 'gh-recent-name' }, repo.name),
								h('span', { className: 'gh-recent-at' }, timeAgo(repo.pushedAt)),
							))),
					),
				),
			)
		}

		function Page() {
			const [state, setState] = useState(null)
			const [repos, setRepos] = useState(null)
			const [feed, setFeed] = useState(null)
			const [tab, setTab] = useState('dash')
			const [busy, setBusy] = useState({ kind: null, full: null })
			const [notice, setNotice] = useState(null)
			const [loadingFeed, setLoadingFeed] = useState(false)
			const [reposError, setReposError] = useState(null)
			const [overview, setOverview] = useState(null)
			const [overviewError, setOverviewError] = useState(null)
			const [loadingOverview, setLoadingOverview] = useState(false)

			const loadState = useCallback(() => api('/state').then(setState).catch((error) => setNotice({ kind: 'error', text: error.message })), [])
			const loadRepos = useCallback(() => {
				setReposError(null)
				return api('/repos?perPage=100')
					.then((payload) => { setRepos(payload); setReposError(null) })
					.catch((error) => { setRepos([]); setReposError({ message: error.message }) })
			}, [])
			const loadOverview = useCallback(() => {
				setLoadingOverview(true)
				setOverviewError(null)
				return api('/overview')
					.then(setOverview)
					.catch((error) => setOverviewError(error.message))
					.finally(() => setLoadingOverview(false))
			}, [])
			const loadFeed = useCallback(() => {
				setLoadingFeed(true)
				return api('/feed')
					.then((payload) => setFeed(payload.items ?? []))
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
					.finally(() => setLoadingFeed(false))
			}, [])

			useEffect(() => { loadState() }, [loadState])

			useEffect(() => {
				if (state === null || !state.connected) return
				if (tab === 'dash' && overview === null) loadOverview()
				if ((tab === 'repos' || tab === 'code' || tab === 'issues' || tab === 'pulls' || tab === 'actions' || tab === 'push') && repos === null) loadRepos()
				if (tab === 'feed' && feed === null) loadFeed()
			}, [state, tab, repos, feed, overview, loadRepos, loadFeed, loadOverview])

			const tracked = state === null ? [] : state.settings?.tracked ?? []
			const repoOptions = useMemo(() => repos === null || repos.items === undefined ? tracked.map((full) => ({ full })) : repos.items.map((repo) => ({ full: repo.full })), [repos, tracked])
			const stars = state === null ? {} : state.repos ?? {}

			const onTrack = useCallback((full, on) => {
				setBusy({ kind: 'track', full })
				api('/track', { method: 'POST', body: { full, tracked: on } })
					.then((payload) => {
						setState((previous) => previous === null ? previous : { ...previous, settings: { ...previous.settings, tracked: payload.tracked } })
						setRepos((previous) => previous === null ? previous : { ...previous, items: previous.items.map((repo) => repo.full === full ? { ...repo, tracked: !repo.tracked } : repo) })
						if (on) {
							setNotice({ kind: 'ok', text: `开始记录 ${full}` })
							return api('/refresh', { method: 'POST', body: { fulls: [full] } }).then((payload) => {
								if (payload.state !== undefined) setState(payload.state)
								const failed = payload.failed ?? []
								setNotice(failed.length > 0 ? { kind: 'error', text: failed[0].message } : { kind: 'ok', text: `${full} 的 star 已记录：${payload.refreshed?.[0]?.stars ?? '?'}` })
							})
						}
						setNotice({ kind: 'ok', text: `停止记录 ${full}` })
						return null
					})
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
					.finally(() => setBusy({ kind: null, full: null }))
			}, [])

			const saveSettings = useCallback((patch) => {
				return api('/settings', { method: 'POST', body: patch })
					.then((payload) => {
						setState((previous) => previous === null ? previous : { ...previous, settings: payload.settings })
						setNotice({ kind: 'ok', text: '设置已保存' })
					})
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
			}, [])

			const onStar = useCallback((full, starred) => {
				setBusy({ kind: 'star', full })
				api('/star', { method: 'POST', body: { full, starred } })
					.then(() => {
						setRepos((previous) => previous === null ? previous : { ...previous, items: previous.items.map((repo) => repo.full === full ? { ...repo, starred } : repo) })
						setNotice({ kind: 'ok', text: starred ? `已 star ${full}` : `已取消 star ${full}` })
					})
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
					.finally(() => setBusy({ kind: null, full: null }))
			}, [])

			const onCreated = useCallback((full) => {
				setNotice({ kind: 'ok', text: `已创建仓库 ${full}` })
				setRepos(null)
				loadState()
			}, [loadState])

			const onRefresh = useCallback((fulls) => {
				setBusy({ kind: 'refresh', full: fulls === undefined ? null : fulls[0] })
				api('/refresh', { method: 'POST', body: fulls === undefined ? {} : { fulls } })
					.then((payload) => {
						if (payload.state !== undefined) setState(payload.state)
						const failed = payload.failed ?? []
						setNotice(failed.length > 0
							? { kind: 'error', text: `${failed.length} 个失败：${failed[0].full} ${failed[0].message}` }
							: { kind: 'ok', text: `已刷新 ${payload.refreshed?.length ?? 0} 个仓库` })
					})
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
					.finally(() => setBusy({ kind: null, full: null }))
			}, [])

			const disconnect = useCallback(() => {
				api('/token', { method: 'DELETE' })
					.then(() => {
						setState(null); setRepos(null); setFeed(null); setNotice(null)
						loadState()
					})
					.catch((error) => setNotice({ kind: 'error', text: error.message }))
			}, [loadState])

			const header = h(
				'div',
				{ className: 'gh-head' },
				h(
					'div',
					null,
					h('div', { className: 'gh-title' }, 'GitHub 中心'),
					h('div', { className: 'gh-sub' }, '仓库、项目更新、star 变化，以及直接提交代码。'),
				),
				state !== null && state.connected
					? h('button', { type: 'button', className: 'gh-btn', 'data-kind': 'danger', onClick: disconnect }, '断开连接')
					: null,
			)

			if (state === null) return h('div', { className: 'gh' }, h('style', null, CSS), header, h('div', { className: 'gh-state' }, '正在读取状态…'))

			if (!state.connected) {
				return h(
					'div',
					{ className: 'gh' },
					h('style', null, CSS),
					header,
					h(ConnectCard, { onConnected: () => { setNotice({ kind: 'ok', text: '已连接' }); loadState() } }),
					notice === null ? null : h('div', { className: 'gh-note', 'data-kind': notice.kind === 'error' ? 'error' : 'done' }, notice.text),
				)
			}

			const viewer = state.viewer
			const account = h(
				'div',
				{ className: 'gh-card' },
				h(
					'div',
					{ className: 'gh-row' },
					viewer !== null && viewer.avatar !== '' ? h('img', { className: 'gh-avatar', src: viewer.avatar, alt: '' }) : null,
					h(
						'div',
						null,
						h('div', { className: 'gh-login' }, viewer === null ? '已连接' : viewer.login + (viewer.name === '' ? '' : ` · ${viewer.name}`)),
						h('div', { className: 'gh-hint' }, viewer === null ? '' : `公开仓库 ${viewer.publicRepos} · 关注者 ${viewer.followers}`),
					),
					state.rateLimit !== null && state.rateLimit !== undefined
						? h('span', { className: 'gh-hint', style: { marginLeft: 'auto' } }, `API 剩余 ${state.rateLimit.remaining}/${state.rateLimit.limit}`)
						: null,
					viewer !== null && viewer.htmlUrl !== '' ? h('a', { className: 'gh-link', href: viewer.htmlUrl, target: '_blank', rel: 'noreferrer' }, '主页') : null,
				),
				state.error === null || state.error === undefined ? null : h('div', { className: 'gh-note', 'data-kind': 'error' }, state.error.message),
			)

			const tabs = [['dash', '概览'], ['repos', '仓库'], ['code', '代码'], ['issues', 'Issues'], ['pulls', 'PR'], ['actions', 'Actions'], ['notify', '通知'], ['feed', '项目更新'], ['stars', 'Star'], ['push', '提交']]

			return h(
				'div',
				{ className: 'gh' },
				h('style', null, CSS),
				header,
				account,
				h(
					'div',
					{ className: 'gh-tabs' },
					tabs.map(([id, label]) => h('button', { key: id, type: 'button', className: 'gh-tab', 'data-on': tab === id ? '1' : '0', onClick: () => setTab(id) }, label)),
				),
				tab === 'dash' ? h(Dashboard, { overview, loading: loadingOverview, error: overviewError, onReload: loadOverview }) : null,
				tab === 'repos' ? h(RepoList, { state: repos, error: reposError, onTrack, onRefreshOne: (full) => onRefresh([full]), onStar, onCreated, busyFull: busy.kind === 'refresh' || busy.kind === 'star' ? busy.full : null, notice }) : null,
				tab === 'code' ? h(CodePanel, { repos: repoOptions }) : null,
				tab === 'issues' ? h(IssuePanel, { repos: repoOptions }) : null,
				tab === 'actions' ? h(ActionPanel, { repos: repoOptions }) : null,
				tab === 'pulls' ? h(PullPanel, { repos: repoOptions }) : null,
				tab === 'notify' ? h(NotifyPanel, null) : null,
				tab === 'feed' ? h(FeedPanel, { feed, onReload: loadFeed, loading: loadingFeed }) : null,
				tab === 'stars' ? h(StarPanel, { tracked, stars, settings: state.settings, onRefresh: () => onRefresh(), onSaveSettings: saveSettings, busy: busy.kind === 'refresh' && busy.full === null, notice }) : null,
				tab === 'push' ? h(PushPanel, { repos: repos === null ? [] : repos.items ?? [], tracked, notice, setNotice }) : null,
				tab === 'push' ? h(ReleaseForm, { repos: repoOptions, onDone: (payload) => setNotice({ kind: 'ok', text: '已发布 ' + (payload.tag === undefined ? '' : payload.tag) }) }) : null,
			)
		}

		function HubIcon(props) {
			const size = (props && props.size) || 18
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
				},
				h('path', { d: 'M9 19c-4.3 1.3-4.3-2.2-6-2.7' }),
				h('path', { d: 'M15 21v-3.4c0-1 .1-1.4-.5-2 2.3-.3 4.6-1.1 4.6-5.1a4 4 0 0 0-1.1-2.8 3.7 3.7 0 0 0-.1-2.8s-.9-.3-3 1.1a10.4 10.4 0 0 0-5.4 0C7.4 3.6 6.5 3.9 6.5 3.9a3.7 3.7 0 0 0-.1 2.8A4 4 0 0 0 5.3 9.6c0 3.9 2.3 4.8 4.6 5.1-.4.4-.5.9-.5 1.5V21' }),
			)
		}

		function PanelPage() {
			return h('div', { className: 'gh-full' }, h(Page, null))
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				app.ctx = ctx
				ctx.effect(
					() =>
						ctx.locale.register(NS, {
							zh: { nav: 'GitHub 中心' },
							en: { nav: 'GitHub Hub' },
						}),
					'dsh-github-hub: dictionaries',
				)
				const t = ctx.locale.bind(NS)
				ctx.slots.inject('settings.section', () =>
					ctx.slots.register(
						{
							name: 'settings.section',
							id: 'github-hub',
							order: 34,
							label: () => t('nav'),
							locale: NS,
						},
						Page,
					),
				)
				ctx.slots.inject('main', () =>
					ctx.slots.register({ name: 'main', key: 'github-hub', order: 32 }, PanelPage),
				)
				ctx.slots.inject('sidebar.panellist', () =>
					ctx.slots.register(
						{ name: 'sidebar.panellist', id: 'github-hub', order: 26, label: () => t('nav') },
						HubIcon,
					),
				)
			},
		}
	},
})
