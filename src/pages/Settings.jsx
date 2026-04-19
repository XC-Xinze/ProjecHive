import { useStore } from '../store'
import { THEME_LIST } from '../themes'

export default function Settings() {
  const { theme, setTheme, currentUser } = useStore()

  return (
    <div className="p-10 max-w-3xl">
      <h2 className="font-display font-bold text-xl text-on-surface mb-8">Settings</h2>

      {/* ── Theme ── */}
      <section className="mb-10">
        <h3 className="font-display font-semibold text-sm text-on-surface mb-4">Theme</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEME_LIST.map((t) => {
            const active = theme === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex items-center gap-4 p-4 rounded-xl text-left cursor-pointer transition-all ${
                  active
                    ? 'bg-primary-surface ring-2 ring-[var(--color-primary)]'
                    : 'bg-surface-card shadow-card hover:shadow-lifted'
                }`}
              >
                {/* Color swatches */}
                <div className="flex -space-x-1.5 shrink-0">
                  {t.preview.map((color, i) => (
                    <span
                      key={i}
                      className="w-6 h-6 rounded-full ring-2 ring-white"
                      style={{ backgroundColor: color, zIndex: 3 - i }}
                    />
                  ))}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${active ? 'text-primary' : 'text-on-surface'}`}>
                    {t.name}
                  </p>
                  <p className="text-xs text-on-surface-dim truncate">{t.description}</p>
                </div>
                {active && (
                  <svg className="w-5 h-5 text-primary shrink-0 ml-auto" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </section>

      {/* ── About ── */}
      <section>
        <h3 className="font-display font-semibold text-sm text-on-surface mb-4">About</h3>
        <div className="bg-surface-card rounded-xl shadow-card p-6">
          <div className="flex items-center gap-4 mb-5">
            {/* Logo placeholder — replace src with your logo file */}
            <div className="w-12 h-12 gradient-primary rounded-xl flex items-center justify-center overflow-hidden">
              <img
                src="/logo.svg"
                alt="ProjectHive"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none'
                  e.target.parentElement.innerHTML = '<span style="color:white;font-weight:700;font-size:20px">PH</span>'
                }}
              />
            </div>
            <div>
              <h4 className="font-display font-bold text-lg text-on-surface">ProjectHive</h4>
              <p className="text-xs text-on-surface-dim">Collaborative research project management</p>
            </div>
          </div>

          <div className="space-y-3">
            <InfoRow label="Version" value="v1.2.1" />
            <InfoRow label="Platform" value="Electron + React + Vite" />
            <InfoRow label="Backend" value="GitHub Private Repository" />
            {currentUser && (
              <InfoRow label="Signed in as" value={currentUser.login} />
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-dim">Author</span>
              <a
                href="https://www.bezenx.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                www.bezenx.com
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-on-surface-dim">Repository</span>
              <a
                href="https://github.com/XC-Xinze/ProjecHive"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                github.com/XC-Xinze/ProjecHive
              </a>
            </div>
          </div>

          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--color-surface-highest)' }}>
            <p className="text-xs text-on-surface-dim leading-relaxed">
              ProjectHive is a lightweight desktop application designed for research groups to collaborate on projects using GitHub as the backend.
              Tasks, messages, documents, and timelines are all synced through a private GitHub repository — no extra server needed.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-on-surface-dim">{label}</span>
      <span className="text-xs font-medium text-on-surface-variant">{value}</span>
    </div>
  )
}
