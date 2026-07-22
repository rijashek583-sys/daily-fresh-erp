const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk(srcDir);

// Data variables that we want to extract from useDataStore
const DATA_VARS = ['clients', 'orders', 'products', 'regions', 'clientPricing', 'payments', 'ledgerEntries'];

files.forEach(file => {
  // Skip the data store itself and mock/data.ts
  if (file.includes('dataStore.ts') || file.includes('mock\\data.ts') || file.includes('types\\index.ts') || file.includes('firebase.ts') || file.includes('db.ts')) {
    return;
  }

  let content = fs.readFileSync(file, 'utf8');
  let originalContent = content;
  
  // Look for import {...} from '.../mock/data'
  const mockImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"](?:\.\.\/)+mock\/data['"];?/g;
  let match;
  let usedDataVars = new Set();
  
  while ((match = mockImportRegex.exec(content)) !== null) {
    const importedItems = match[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
    importedItems.forEach(item => {
      // Remove type imports and non-data vars
      if (!item.startsWith('type ') && DATA_VARS.includes(item)) {
        usedDataVars.add(item);
      }
    });
  }

  if (usedDataVars.size > 0) {
    // 1. Remove the data vars from the mock import, keeping types if any.
    // Actually, we'll just replace the whole mock import with our types import and dataStore import.
    content = content.replace(mockImportRegex, (fullMatch, group1) => {
      const items = group1.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const typesToKeep = items.filter(item => item.startsWith('type ') || !DATA_VARS.includes(item));
      
      let newImport = '';
      if (typesToKeep.length > 0) {
         // Determine relative path to types
         const depth = (file.match(/\\/g) || []).length - (srcDir.match(/\\/g) || []).length;
         const relPath = depth === 1 ? '../types' : depth === 2 ? '../../types' : '../../../types';
         newImport += `import { ${typesToKeep.join(', ')} } from '${relPath}';\n`;
      }
      
      const depth = (file.match(/\\/g) || []).length - (srcDir.match(/\\/g) || []).length;
      const relPathStore = depth === 1 ? '../stores/dataStore' : depth === 2 ? '../../stores/dataStore' : '../../../stores/dataStore';
      newImport += `import { useDataStore } from '${relPathStore}';`;
      
      return newImport;
    });

    // 2. Inject the hook call inside the component.
    // Find the default export function or export function
    const funcRegex = /export\s+(?:default\s+)?function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{/;
    const funcMatch = funcRegex.exec(content);
    
    if (funcMatch) {
      const hookInjection = `\n  const { ${Array.from(usedDataVars).join(', ')} } = useDataStore();`;
      content = content.substring(0, funcMatch.index + funcMatch[0].length) + hookInjection + content.substring(funcMatch.index + funcMatch[0].length);
    } else {
      // If it's a utility file like `billing.ts`, we can't use hooks.
      // We will need to handle `billing.ts` manually.
      if (file.endsWith('billing.ts')) {
         console.log('Skipping hook injection for utility file:', file);
      }
    }
    
    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log('Updated:', file);
    }
  }
});
