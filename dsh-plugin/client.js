window.__ModuleLoader__.load({
  id: 'dsh-plugin-agy-collab',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    const DASHBOARD_URL = '/plugin/agy-collab/dashboard';
    const TASKS_URL = '/plugin/agy-collab/tasks';
    const SETTINGS_URL = '/plugin/agy-collab/settings';
    const REFRESH_MS = 10_000;
    const STYLE_ID = 'agy-collab-dock-css';

    function injectCss() {
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = `
        .agy-chip {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 2px 8px; margin: -2px -4px; border-radius: 8px; border: none;
          background: transparent; font: inherit; font-size: 12px; line-height: 18px;
          color: var(--dsw-alias-label-tertiary, #9ca3af); cursor: pointer; white-space: nowrap;
        }
        .agy-chip:hover { background: rgba(255,255,255,0.08); color: var(--dsw-alias-label-primary, #f3f4f6); }
        .agy-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
        .agy-dot-on { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
        .agy-dot-off { background: #6b7280; }
        .agy-count {
          background: rgba(56,189,248,0.22); color: #38bdf8;
          padding: 0 5px; border-radius: 999px; font-size: 10px; font-weight: 600;
        }
        .agy-popover {
          position: fixed; z-index: 99999; width: 380px; max-height: 480px; overflow-y: auto;
          padding: 12px; border-radius: 14px;
          background: var(--dsw-alias-bg-overlay, rgba(30, 32, 38, 0.92));
          backdrop-filter: blur(var(--we-blur, 14px)) saturate(var(--we-saturate, 1.3));
          border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.14));
          color: var(--dsw-alias-label-primary, #f3f4f6);
          box-shadow: 0 12px 32px rgba(0,0,0,0.35);
          font-size: 12px; line-height: 1.45;
        }
        .agy-pop-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .agy-pop-title { font-weight: 700; font-size: 13px; display: flex; align-items: center; gap: 6px; }
        .agy-btn {
          background: rgba(255,255,255,0.08); color: inherit; border: 1px solid rgba(255,255,255,0.14);
          padding: 4px 9px; border-radius: 7px; cursor: pointer; font-size: 11px;
        }
        .agy-btn:hover { background: rgba(255,255,255,0.15); }
        .agy-btn-pri { background: var(--we-accent, #38bdf8); color: #0b1020; border-color: transparent; font-weight: 600; }
        .agy-form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .agy-input {
          background: rgba(0,0,0,0.22); color: inherit; border: 1px solid rgba(255,255,255,0.14);
          border-radius: 7px; padding: 5px 8px; font: inherit; width: 100%; box-sizing: border-box;
        }
        .agy-task {
          background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.09);
          border-radius: 9px; padding: 8px; margin-bottom: 6px;
        }
        .agy-task-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9ca3af); display: flex; gap: 6px; margin-bottom: 3px; }
        .agy-task-title { font-weight: 600; margin-bottom: 4px; }
        .agy-review { font-size: 11px; padding: 5px 7px; border-radius: 6px; background: rgba(56,189,248,0.1); margin-top: 4px; }
      `;
    }

    function CollabDock() {
      const [data, setData] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [pos, setPos] = React.useState({ left: 24, bottom: 80 });
      const [title, setTitle] = React.useState('');
      const [files, setFiles] = React.useState('');
      const [prompt, setPrompt] = React.useState('');
      const [showManual, setShowManual] = React.useState(false);
      const [tip, setTip] = React.useState('');
      const chipRef = React.useRef(null);

      const load = React.useCallback(async () => {
        try {
          const r = await fetch(DASHBOARD_URL, { cache: 'no-store' });
          const json = await r.json();
          setData(json);
        } catch {
          setData({ ok: false });
        }
      }, []);

      React.useEffect(() => {
        injectCss();
        void load();
        const id = setInterval(load, REFRESH_MS);
        const onVis = () => { if (!document.hidden) void load(); };
        document.addEventListener('visibilitychange', onVis);
        return () => {
          clearInterval(id);
          document.removeEventListener('visibilitychange', onVis);
        };
      }, [load]);

      React.useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open]);

      const toggleOpen = () => {
        if (!open && chipRef.current) {
          const rect = chipRef.current.getBoundingClientRect();
          setPos({
            left: Math.max(12, Math.min(rect.left, window.innerWidth - 396)),
            bottom: Math.max(16, window.innerHeight - rect.top + 8),
          });
          void load();
        }
        setOpen((v) => !v);
      };

      const submitTask = async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        const fileList = files.trim() ? files.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean) : [];
        const r = await fetch(TASKS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), kind: 'code_review', files: fileList, prompt: prompt.trim() }),
        });
        const j = await r.json().catch(() => ({ ok: false }));
        if (j.ok) {
          setTitle('');
          setFiles('');
          setPrompt('');
          setTip('已发送给 Antigravity 审查');
          void load();
        } else {
          setTip(j.error || '发送失败');
        }
      };

      const toggleAutoWake = async (key) => {
        const next = !data?.settings?.[key];
        await fetch(SETTINGS_URL, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [key]: next }),
        });
        void load();
      };

      const agyOn = Boolean(data?.peers?.antigravity?.online);
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const pendingForDsh = tasks.filter((t) => t.to === 'deepseek' && t.status === 'pending').length;

      const popover = open
        ? h(
            'div',
            { className: 'agy-popover', style: { left: pos.left, bottom: pos.bottom } },
            h(
              'div',
              { className: 'agy-pop-head' },
              h(
                'div',
                { className: 'agy-pop-title' },
                h('span', { className: `agy-dot ${agyOn ? 'agy-dot-on' : 'agy-dot-off'}` }),
                'Antigravity 全自动双向协同'
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 6 } },
                h('button', { className: 'agy-btn', onClick: load }, '刷新'),
                h('button', { className: 'agy-btn', onClick: () => setOpen(false) }, '关闭')
              )
            ),
            h(
              'div',
              { style: { fontSize: 11, opacity: 0.78, marginBottom: 8 } },
              '平时无需填表：直接用自然语言对 DeepSeek 或 Antigravity 说即可自动互审与同步。'
            ),
            h(
              'div',
              { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 } },
              h(
                'button',
                { className: 'agy-btn', onClick: () => toggleAutoWake('autoWakeAgy') },
                data?.settings?.autoWakeAgy ? 'AGY 自动唤醒: 开' : 'AGY 自动唤醒: 关'
              ),
              h(
                'button',
                { className: 'agy-btn', onClick: () => toggleAutoWake('autoWakeDsh') },
                data?.settings?.autoWakeDsh ? 'DSH 自动审查: 开' : 'DSH 自动审查: 关'
              ),
              h(
                'button',
                { className: 'agy-btn', onClick: () => setShowManual((v) => !v) },
                showManual ? '收起手动表单' : '+ 手动发单'
              )
            ),
            tip ? h('div', { style: { color: '#38bdf8', marginBottom: 6 } }, tip) : null,
            showManual
              ? h(
                  'form',
                  { className: 'agy-form', onSubmit: submitTask },
                  h('input', {
                    className: 'agy-input',
                    placeholder: '发给 Antigravity 审查的标题...',
                    value: title,
                    onChange: (e) => setTitle(e.target.value),
                  }),
                  h('input', {
                    className: 'agy-input',
                    placeholder: '涉及文件路径（逗号分隔，可选）',
                    value: files,
                    onChange: (e) => setFiles(e.target.value),
                  }),
                  h('textarea', {
                    className: 'agy-input',
                    rows: 2,
                    placeholder: '审查重点说明...',
                    value: prompt,
                    onChange: (e) => setPrompt(e.target.value),
                  }),
                  h('button', { type: 'submit', className: 'agy-btn agy-btn-pri' }, '发给 Antigravity 审查')
                )
              : null,
            tasks.length === 0
              ? h('div', { style: { opacity: 0.65, textAlign: 'center', padding: 12 } }, '暂无双向协同任务')
              : tasks.slice(0, 8).map((t) => {
                  const lastRev = t.reviews?.[t.reviews.length - 1];
                  return h(
                    'div',
                    { key: t.id, className: 'agy-task' },
                    h(
                      'div',
                      { className: 'agy-task-meta' },
                      h('span', null, t.from === 'deepseek' ? 'DSH → AGY' : 'AGY → DSH'),
                      h('span', null, `· ${t.status}`)
                    ),
                    h('div', { className: 'agy-task-title' }, t.title),
                    lastRev
                      ? h('div', { className: 'agy-review' }, `[${lastRev.verdict}] ${lastRev.summary}`)
                      : null,
                    t.to === 'deepseek'
                      ? h(
                          'button',
                          {
                            className: 'agy-btn',
                            style: { marginTop: 6 },
                            onClick: () => {
                              const text = `请审查来自 Antigravity 的任务 ${t.id}（${t.title}），先调用 agy_list_tasks 查看详情，审查后调用 agy_submit_review 提交结论。`;
                              navigator.clipboard?.writeText(text);
                              setTip('已复制审查指令，粘贴给 DeepSeek 即可开始');
                            },
                          },
                          '复制指令给当前对话'
                        )
                      : null
                  );
                })
          )
        : null;

      return h(
        React.Fragment,
        null,
        h(
          'button',
          { ref: chipRef, type: 'button', className: 'agy-chip', onClick: toggleOpen, title: 'Antigravity 双向协同台' },
          h('span', { className: `agy-dot ${agyOn ? 'agy-dot-on' : 'agy-dot-off'}` }),
          h('span', null, 'AGY 协同'),
          pendingForDsh > 0 ? h('span', { className: 'agy-count' }, String(pendingForDsh)) : null
        ),
        popover && ReactDOM?.createPortal ? ReactDOM.createPortal(popover, document.body) : popover
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => {
          injectCss();
          return ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'agy-collab',
              order: -5,
            },
            () => h(CollabDock)
          );
        });
      },
    };
  },
});
