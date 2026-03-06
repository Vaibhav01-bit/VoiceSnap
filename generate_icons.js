const fs = require('fs');
const sharp = require('sharp');

// Enhanced 3D Logo Design: Modern, glossy, dynamic look
const createLogoSvg = (size) => {
  const s = size;
  
  return `
<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Main blue-purple gradient -->
    <linearGradient id="mainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366F1;stop-opacity:1" />
      <stop offset="50%" style="stop-color:#8B5CF6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#D946EF;stop-opacity:1" />
    </linearGradient>
    
    <!-- Glossy highlight gradient -->
    <linearGradient id="glossGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.4" />
      <stop offset="50%" style="stop-color:#ffffff;stop-opacity:0" />
    </linearGradient>
    
    <!-- 3D shadow gradient -->
    <radialGradient id="shadowGrad" cx="50%" cy="100%" r="80%">
      <stop offset="0%" style="stop-color:#1E1B4B;stop-opacity:0.5" />
      <stop offset="100%" style="stop-color:#1E1B4B;stop-opacity:0" />
    </radialGradient>
    
    <!-- Microphone metallic gradient -->
    <linearGradient id="micGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#F8FAFC;stop-opacity:1" />
      <stop offset="30%" style="stop-color:#E2E8F0;stop-opacity:1" />
      <stop offset="70%" style="stop-color:#CBD5E1;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#94A3B8;stop-opacity:1" />
    </linearGradient>
    
    <!-- Glow effect -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${s * 0.08}" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- 3D Drop shadow -->
    <filter id="dropShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${s * 0.04}" stdDeviation="${s * 0.06}" flood-color="#1E1B4B" flood-opacity="0.4"/>
    </filter>
    
    <!-- Inner glow for camera ring -->
    <filter id="ringGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${s * 0.03}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- 3D Background circle with shadow -->
  <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.42}" fill="url(#shadowGrad)"/>
  <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.42}" fill="url(#mainGrad)"/>
  
  <!-- Glossy overlay -->
  <ellipse cx="${s*0.5}" cy="${s*0.25}" rx="${s*0.35}" ry="${s*0.2}" fill="url(#glossGrad)"/>
  
  <!-- Camera shutter frame - 3D effect with segments -->
  <g filter="url(#ringGlow)">
    <!-- Outer ring segments -->
    <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.35}" fill="none" stroke="white" stroke-width="${s*0.04}" stroke-dasharray="${s*0.12} ${s*0.08}" stroke-linecap="round" opacity="0.9"/>
    <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.28}" fill="none" stroke="white" stroke-width="${s*0.025}" stroke-dasharray="${s*0.08} ${s*0.06}" stroke-linecap="round" opacity="0.7"/>
  </g>
  
  <!-- Microphone body - 3D look -->
  <g filter="url(#dropShadow)">
    <!-- Main mic body -->
    <rect x="${s*0.38}" y="${s*0.32}" width="${s*0.24}" height="${s*0.28}" rx="${s*0.12}" fill="url(#micGrad)"/>
    
    <!-- Mic highlight -->
    <rect x="${s*0.40}" y="${s*0.34}" width="${s*0.08}" height="${s*0.22}" rx="${s*0.04}" fill="white" opacity="0.4"/>
  </g>
  
  <!-- Microphone stand - curved 3D effect -->
  <path d="M ${s*0.38} ${s*0.58} Q ${s*0.38} ${s*0.72} ${s*0.5} ${s*0.72} Q ${s*0.62} ${s*0.72} ${s*0.62} ${s*0.58}" 
        fill="none" stroke="url(#micGrad)" stroke-width="${s*0.045}" stroke-linecap="round"/>
  
  <!-- Stand base -->
  <line x1="${s*0.42}" y1="${s*0.72}" x2="${s*0.58}" y2="${s*0.72}" stroke="url(#micGrad)" stroke-width="${s*0.04}" stroke-linecap="round"/>
  
  <!-- Animated pulse ring effect (outer glow) -->
  <circle cx="${s*0.5}" cy="${s*0.5}" r="${s*0.42}" fill="none" stroke="#D946EF" stroke-width="${s * 0.015}" opacity="0.6">
    <animate attributeName="r" values="${s*0.42};${s*0.46};${s*0.42}" dur="2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite"/>
  </circle>
  
  <!-- Sound wave indicators -->
  <g opacity="0.8">
    <path d="M ${s*0.18} ${s*0.45} Q ${s*0.14} ${s*0.5} ${s*0.18} ${s*0.55}" fill="none" stroke="white" stroke-width="${s*0.025}" stroke-linecap="round">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite"/>
    </path>
    <path d="M ${s*0.82} ${s*0.45} Q ${s*0.86} ${s*0.5} ${s*0.82} ${s*0.55}" fill="none" stroke="white" stroke-width="${s*0.025}" stroke-linecap="round">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" begin="0.5s"/>
    </path>
  </g>
  
  <!-- Red recording dot with glow -->
  <circle cx="${s*0.75}" cy="${s*0.25}" r="${s*0.07}" fill="#EF4444" filter="url(#glow)">
    <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite"/>
  </circle>
  
  <!-- Sparkle effects -->
  <circle cx="${s*0.22}" cy="${s*0.28}" r="${s*0.025}" fill="white" opacity="0.9">
    <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.2s" repeatCount="indefinite"/>
    <animate attributeName="r" values="${s*0.025};${s*0.015};${s*0.025}" dur="1.2s" repeatCount="indefinite"/>
  </circle>
  <circle cx="${s*0.78}" cy="${s*0.72}" r="${s*0.02}" fill="white" opacity="0.7">
    <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.4s" repeatCount="indefinite" begin="0.3s"/>
  </circle>
</svg>`;
};

// Generate icons at different sizes
const sizes = [16, 48, 128];
const iconNames = ['icon16.png', 'icon48.png', 'icon128.png'];

async function generateIcons() {
  console.log('Generating enhanced 3D VoiceSnap logo icons...');
  
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const svg = createLogoSvg(size);
    const outputPath = `d:/sceernshotboom/icons/${iconNames[i]}`;
    
    // For 16x16, simplify the SVG to avoid rendering issues
    let finalSvg = svg;
    if (size === 16) {
      // Simplified version for small size
      finalSvg = `
<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366F1"/>
      <stop offset="100%" style="stop-color:#D946EF"/>
    </linearGradient>
  </defs>
  <circle cx="8" cy="8" r="7" fill="url(#g)"/>
  <rect x="5.5" y="5" width="5" height="5" rx="1.5" fill="white"/>
  <circle cx="12" cy="4" r="1.5" fill="#EF4444"/>
</svg>`;
    }
    
    await sharp(Buffer.from(finalSvg))
      .png()
      .toFile(outputPath);
    
    console.log(`Generated: ${iconNames[i]} (${size}x${size})`);
  }
  
  console.log('All enhanced 3D icons generated successfully!');
}

generateIcons().catch(console.error);
