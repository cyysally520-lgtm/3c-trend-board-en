import React, { useState } from 'react';
import { Clock, Users, Coins, Sparkles, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { CrowdfundingItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface CrowdCardProps {
  item: CrowdfundingItem;
}

export const CrowdCard: React.FC<CrowdCardProps> = ({ item }) => {
  const [showAiInsight, setShowAiInsight] = useState(false);

  // Formatting currency
  const formatRaised = (num: number, symbol: string) => {
    return `${symbol}${num.toLocaleString()}`;
  };

  // Safe color for platform badge
  const getPlatformStyle = (platform: string) => {
    switch (platform) {
      case 'Kickstarter':
        return 'bg-[#059669] text-white';
      case 'Indiegogo':
        return 'bg-[#e5195e] text-white';
      case 'Makuake':
        return 'bg-[#f59e0b] text-slate-900';
      case 'Crowd Supply':
        return 'bg-[#f97316] text-white';
      default:
        return 'bg-slate-500 text-white';
    }
  };

  return (
    <div 
      id={`crowd-card-${item.id}`}
      className="group bg-white rounded-xl shadow-xs overflow-hidden border border-slate-100 flex flex-col justify-between hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
    >
      {/* 43 aspect container for image */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-50">
        <img 
          src={item.image} 
          alt={item.name} 
          className="object-cover w-full h-full group-hover:scale-104 transition-transform duration-500" 
          referrerPolicy="no-referrer"
        />
        
        {/* Platform Badge (E.g. Indiegogo in pink prompt, bold capsule) */}
        <div className="absolute top-3 left-3 select-none">
          <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-xs tracking-wider uppercase shadow-xs ${getPlatformStyle(item.platform)}`}>
            {item.platform}
          </span>
        </div>

        {/* Floating currency reminder */}
        <div className="absolute bottom-3 right-3 bg-slate-900/60 backdrop-blur-xs text-white text-[10px] font-mono font-medium px-2 py-0.5 rounded-sm">
          {item.currency}
        </div>
      </div>

      {/* SOLID EMERALD SEPARATOR LINE (MATCHES REF IMAGE 2 PERFECTLY) */}
      <div className="h-[3px] bg-[#10b981] w-full shrink-0"></div>

      {/* Card Details Body */}
      <div className="p-5 flex-grow flex flex-col justify-between gap-4">
        
        {/* Title and Founder Area */}
        <div>
          {/* 产品名称（英文原文优先） */}
          <h3 className="text-[15px] font-bold text-[#1e293b] leading-snug font-sans tracking-tight line-clamp-2 group-hover:text-emerald-700 transition-colors">
            {item.name}
          </h3>
          
          {/* Founder and Location line inline */}
          <div className="text-[13px] text-slate-400 mt-1.5 flex items-center gap-1.5 font-medium flex-wrap">
            <span>{item.founder}</span>
            <span className="text-slate-300 select-none font-normal">·</span>
            <span>{item.location}</span>
          </div>
        </div>

        {/* High Precision Stats Rows (Lucide Icons, clean bullets, colored metrics) */}
        <div className="space-y-3 bg-[#f8fafc]/80 p-4 rounded-xl border border-slate-100">
          
          {/* Row 1: Raised + (KS: Days left, 其他: Progress %) */}
          <div className="flex items-center justify-between text-[12px] sm:text-[13px] text-slate-600 gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="whitespace-nowrap">
                Raised <strong className="text-slate-800 font-bold font-mono">{formatRaised(item.raised, item.currencySymbol)}</strong>
              </span>
            </div>
            {item.platform === 'Kickstarter' && typeof item.daysLeft === 'number' ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-slate-400 font-normal">Days left</span>
                <span className={`font-bold font-mono ${item.daysLeft === 0 ? 'text-slate-400' : 'text-[#10b981]'}`}>
                  {item.daysLeft === 0 ? 'Ended' : item.daysLeft}
                </span>
              </div>
            ) : item.progress_pct > 0 ? (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-slate-400 font-normal">Progress</span>
                <span className="text-[#10b981] font-bold font-mono">{item.progress_pct}%</span>
              </div>
            ) : null}
          </div>

          {/* Progress bar：所有卡片都画一根绿线作视觉分隔
              KS 不显示百分比（数字过大），但仍画满格作为视觉一致；其他平台按真实 progress 填充 */}
          <div className="py-0.5">
            <div className="w-full bg-slate-100 rounded-full h-[6px] overflow-hidden">
              <div
                style={{
                  width: `${
                    item.platform === 'Kickstarter' || item.progress_pct === 0
                      ? 100
                      : Math.min(item.progress_pct, 100)
                  }%`,
                }}
                className={`h-full rounded-full transition-all duration-500 ${
                  item.progress_pct >= 100
                    || item.progress_pct === 0
                    || item.platform === 'Kickstarter'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                    : 'bg-emerald-500'
                }`}
              ></div>
            </div>
          </div>

          {/* Row 2: Backers & Price */}
          <div className="flex items-center justify-between text-[12px] sm:text-[13px] text-slate-600 gap-2">
            {item.backers > 0 ? (
              <div className="flex items-center gap-1.5 min-w-0">
                <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="whitespace-nowrap">
                  <strong className="text-slate-800 font-bold font-mono">{item.backers.toLocaleString()}</strong> backers
                </span>
              </div>
            ) : <div />}

            {item.price ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <Coins className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="whitespace-nowrap">
                  From <strong className="text-slate-800 font-bold font-mono">{item.price}</strong>
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Categories / Tag pills (Teal pill design: #Category) */}
        <div className="flex flex-wrap gap-1.5">
          <span className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide transition">
            {item.category_tag_en || item.category_tag_zh}
          </span>
        </div>

        {/* AI Insight Bar Trigger Button */}
        <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
          <button 
            onClick={() => setShowAiInsight(!showAiInsight)}
            className="w-full flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50/40 text-emerald-800 hover:bg-emerald-50 font-bold transition cursor-pointer select-none"
          >
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#10b981]" />
              AI Insights
            </span>
            {showAiInsight ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {/* Accordion AI Information utilizing motion layout as required */}
          <AnimatePresence initial={false}>
            {showAiInsight && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="bg-gradient-to-br from-emerald-50/30 to-teal-50/10 border border-emerald-100/50 p-3 rounded-lg space-y-1.5 mt-1">
                  {(item.summary_en && item.summary_en.length > 0 ? item.summary_en : item.summary_zh).map((bullet, idx) => (
                    <div key={idx} className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
                      <span className="text-[#10b981] font-extrabold select-none mt-0.5 shrink-0">•</span>
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Campaign External Target Link */}
          <div className="flex justify-end mt-1">
            <a 
              href={item.campaign_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-emerald-700 transition cursor-pointer"
            >
              View on campaign page
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

      </div>
    </div>
  );
};
