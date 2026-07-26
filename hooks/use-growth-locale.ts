"use client"

import { useEffect, useState } from "react"

const en = {
  recommendationsTitle: "What to promote next",
  recommendationsDescription: "Scored from your own inventory and measured campaign history.",
  approvalsTitle: "Campaign approvals",
  analyticsTitle: "Analytics",
  noAutopublish: "ForgeVid never publishes or contacts prospects automatically.",
  reviewDecision: "Ask Growth Operator",
  generateCampaign: "Generate campaign",
  scheduledOperator: "Scheduled Growth Operator",
  saveSchedule: "Save schedule",
  impactLedger: "Growth impact ledger",
  immutableHistory: "Immutable revision history",
  loading: "Loading…",
}
type Key = keyof typeof en
const translations: Record<string, Partial<Record<Key, string>>> = {
  en,
  es: { recommendationsTitle: "Qué promocionar ahora", recommendationsDescription: "Priorizado con tu inventario y resultados medidos.", approvalsTitle: "Aprobaciones de campañas", analyticsTitle: "Analíticas", noAutopublish: "ForgeVid nunca publica ni contacta prospectos automáticamente.", reviewDecision: "Consultar al Operador de Crecimiento", generateCampaign: "Generar campaña", scheduledOperator: "Operador de Crecimiento programado", saveSchedule: "Guardar programación", impactLedger: "Registro de impacto", immutableHistory: "Historial inmutable", loading: "Cargando…" },
  hi: { recommendationsTitle: "अगला प्रचार क्या करें", approvalsTitle: "अभियान अनुमोदन", analyticsTitle: "विश्लेषण", noAutopublish: "ForgeVid कभी स्वतः प्रकाशित या संभावित ग्राहकों से संपर्क नहीं करता।", reviewDecision: "ग्रोथ ऑपरेटर से पूछें", generateCampaign: "अभियान बनाएँ", scheduledOperator: "निर्धारित ग्रोथ ऑपरेटर", saveSchedule: "समय-सारणी सहेजें", impactLedger: "विकास प्रभाव लेखा", immutableHistory: "अपरिवर्तनीय इतिहास", loading: "लोड हो रहा है…" },
  zh: { recommendationsTitle: "下一步推广什么", approvalsTitle: "广告活动审批", analyticsTitle: "数据分析", noAutopublish: "ForgeVid 绝不会自动发布或联系潜在客户。", reviewDecision: "咨询增长运营助手", generateCampaign: "生成广告活动", scheduledOperator: "定时增长运营助手", saveSchedule: "保存计划", impactLedger: "增长影响账本", immutableHistory: "不可变更历史", loading: "加载中…" },
  ja: { recommendationsTitle: "次に宣伝するもの", approvalsTitle: "キャンペーン承認", analyticsTitle: "分析", noAutopublish: "ForgeVid が自動で公開したり見込み客へ連絡することはありません。", reviewDecision: "グロースオペレーターに相談", generateCampaign: "キャンペーンを生成", scheduledOperator: "定期グロースオペレーター", saveSchedule: "スケジュールを保存", impactLedger: "成長インパクト台帳", immutableHistory: "変更不能な履歴", loading: "読み込み中…" },
  fr: { recommendationsTitle: "Que promouvoir ensuite", approvalsTitle: "Approbations des campagnes", analyticsTitle: "Analyses", noAutopublish: "ForgeVid ne publie jamais et ne contacte jamais de prospects automatiquement.", reviewDecision: "Demander à l’opérateur de croissance", generateCampaign: "Générer la campagne", scheduledOperator: "Opérateur de croissance planifié", saveSchedule: "Enregistrer", impactLedger: "Registre d’impact", immutableHistory: "Historique immuable", loading: "Chargement…" },
  it: { recommendationsTitle: "Cosa promuovere ora", approvalsTitle: "Approvazioni campagne", analyticsTitle: "Analisi", noAutopublish: "ForgeVid non pubblica né contatta potenziali clienti automaticamente.", reviewDecision: "Chiedi all’operatore di crescita", generateCampaign: "Genera campagna", scheduledOperator: "Operatore di crescita programmato", saveSchedule: "Salva programma", impactLedger: "Registro dell’impatto", immutableHistory: "Cronologia immutabile", loading: "Caricamento…" },
  ko: { recommendationsTitle: "다음에 홍보할 항목", approvalsTitle: "캠페인 승인", analyticsTitle: "분석", noAutopublish: "ForgeVid는 자동으로 게시하거나 잠재 고객에게 연락하지 않습니다.", reviewDecision: "성장 운영자에게 문의", generateCampaign: "캠페인 생성", scheduledOperator: "예약된 성장 운영자", saveSchedule: "일정 저장", impactLedger: "성장 영향 원장", immutableHistory: "변경 불가 기록", loading: "불러오는 중…" },
  pt: { recommendationsTitle: "O que promover agora", approvalsTitle: "Aprovações de campanhas", analyticsTitle: "Análises", noAutopublish: "O ForgeVid nunca publica nem contata clientes potenciais automaticamente.", reviewDecision: "Consultar o Operador de Crescimento", generateCampaign: "Gerar campanha", scheduledOperator: "Operador de Crescimento agendado", saveSchedule: "Salvar agenda", impactLedger: "Registro de impacto", immutableHistory: "Histórico imutável", loading: "Carregando…" },
  de: { recommendationsTitle: "Was als Nächstes bewerben", approvalsTitle: "Kampagnenfreigaben", analyticsTitle: "Analysen", noAutopublish: "ForgeVid veröffentlicht oder kontaktiert Interessenten niemals automatisch.", reviewDecision: "Growth Operator fragen", generateCampaign: "Kampagne erstellen", scheduledOperator: "Geplanter Growth Operator", saveSchedule: "Zeitplan speichern", impactLedger: "Wirkungsnachweis", immutableHistory: "Unveränderlicher Verlauf", loading: "Wird geladen…" },
}

export function useGrowthLocale() {
  const [locale, setLocale] = useState("en")
  useEffect(() => {
    fetch("/api/user/profile", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((data) => setLocale(data?.user?.preferences?.language || "en")).catch(() => {})
  }, [])
  return {
    locale,
    t: (key: Key) => translations[locale]?.[key] || en[key],
  }
}
