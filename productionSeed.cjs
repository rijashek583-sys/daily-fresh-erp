// Production Seed Script - Daily Fresh
// Wipes all existing clients, regions, clientPricing and imports master data from handwritten sheets.

const { initializeApp } = require('firebase/app');
const {
  getFirestore, collection, getDocs, doc,
  deleteDoc, setDoc, writeBatch
} = require('firebase/firestore');

const app = initializeApp({
  apiKey: 'AIzaSyBD-isWL5RqNjbUqn2eUOgTCrdgmnSS7qQ',
  authDomain: 'daily-fresh-billing-system.firebaseapp.com',
  projectId: 'daily-fresh-billing-system',
});
const db = getFirestore(app);

// Product IDs confirmed from Firestore
const KUBOOS_ID = 'PROD-1';
const RUMALI_ID = 'PROD-2';
// SOFT and BUN products don't exist yet; we'll skip them

// ─────────────────────────────────────────────
// MASTER DATA from handwritten sheets
// ─────────────────────────────────────────────

const REGIONS = [
  'Kasargode',
  'Uppala',
  'Hosangadi / Thalapady',
  'Mangaluru',
  'Commission',
];

// clients[region] = [ { name, kuboos?, rumali?, soft?, bun? } ]
const CLIENTS_DATA = {
  'Kasargode': [
    { name: 'BAKUR',                  kuboos: 18,   rumali: 10  },
    { name: 'B. GOLDEN',              kuboos: 19,   rumali: 10  },
    { name: 'MALABAR PAIVALLIKE',     kuboos: 19                },
    { name: 'ABADI CHEVAR',           kuboos: 19,   rumali: 10  },
    { name: 'UK SHAWARMA'                                       },
    { name: 'IDEAL CHERKALA',         kuboos: 18,   rumali: 9   },
    { name: 'KONCH'                                             },
    { name: 'METRO',                  kuboos: 19,   rumali: 10  },
    { name: 'ROYAL DYNE',             kuboos: 18,   rumali: 10  },
    { name: 'DARBAR',                 kuboos: 17                },
    { name: 'IKKAS',                  kuboos: 19                },
    { name: 'NEW BADRIYA',            kuboos: 19                },
    { name: 'KENZA',                  kuboos: 19                },
    { name: 'CHAYKADA'                                          },
    { name: 'CHAPATHI',               kuboos: 3.4               },
    { name: 'GULF KUZHIMANTHI',       kuboos: 18                },
    { name: 'LQ BIRIYANI',            kuboos: 18,   rumali: 8.5 },
    { name: 'TEA TIME',               kuboos: 19,   rumali: 10  },
    { name: 'FOOD NEWS'                                         },
    { name: 'ARABIAN KUMBALA',        kuboos: 19                },
    { name: 'MM KUMBALA',             kuboos: 19,   rumali: 9   },
    { name: 'ITALIAN',                kuboos: 19,   rumali: 10  },
    { name: 'RAHMANIYA MOGRAL',       kuboos: 19,   rumali: 9   },
    { name: 'CHOTTU MOGRAL',          kuboos: 17.5              },
    { name: 'HINDUSTAN',              kuboos: 19                },
    { name: 'SHAWYA HUB'                                        },
    { name: 'TAKASHI',                kuboos: 19,   rumali: 10  },
    { name: 'ULIYATHADUKKA MEXICO',                rumali: 9   },
    { name: 'UK FOODLAND',            kuboos: 19,   rumali: 10  },
  ],
  'Uppala': [
    { name: 'BAKEPALACE UPPALA',      kuboos: 18,   rumali: 9   },
    { name: 'TEA TIME UPPALA'                                   },
    { name: 'K3',                     kuboos: 18                },
    { name: 'CHIK HUB',               kuboos: 19,   rumali: 10  },
    { name: 'CHILLY'                                            },
    { name: 'WRAPZO'                                            },
    { name: 'ZAARA',                  kuboos: 17                },
    { name: 'IRANI BENDIYODE',        kuboos: 19,   rumali: 9   },
    { name: 'ELAAN MANTHI',           kuboos: 19                },
    { name: 'THAWA UPPALA',           kuboos: 19,   rumali: 10  },
    { name: 'MEXICO UPPALA',          kuboos: 17                },
    { name: 'SMOCKEY UPPALA'                                    },
    { name: 'IRANI UPPALA',           kuboos: 19,   rumali: 9   },
    { name: 'ROXY DYNE',              kuboos: 19                },
    { name: 'RIZAR LOUNCHE'                                     },
    { name: 'NUTS',                                rumali: 10  },
    { name: 'TAMAKI UPPALA',          kuboos: 19,   rumali: 10  },
    { name: 'MANTHI UPPALA',          kuboos: 20,   rumali: 10  },
    { name: 'MALANDAN'                                          },
    { name: 'ARAFA MAJRPALA'                                    },
    { name: 'INDIAN MAJARPALA'                                  },
    { name: 'ZAMZAM MAJARPALA'                                  },
  ],
  'Hosangadi / Thalapady': [
    { name: 'FOODLAND HOSANGADI'                                },
    { name: 'BUHARI',                 kuboos: 19,   rumali: 10  },
    { name: 'RIMAL MANTHI',           kuboos: 19,   rumali: 10  },
    { name: 'FAMOUS HOSANGADI',       kuboos: 19,   rumali: 10  },
    { name: 'CRISPY HOSANGADI'                                  },
    { name: 'GRILL PALACE HOSANGADI'                            },
    { name: 'AL HASMI',               kuboos: 19                },
    { name: 'FOOD POINT',             kuboos: 20                },
    { name: 'KBC KUNJATHUR',          kuboos: 19                },
    { name: 'BARATH FOOD',            kuboos: 19,   rumali: 10  },
    { name: 'HEAVAN CHIK',            kuboos: 19,   rumali: 10, soft: 20 },
    { name: 'EAT STORY',              kuboos: 19,   rumali: 10  },
    { name: 'SMF MANJESWAR'                                     },
    { name: 'TASTY MANJESWAR'                                   },
    { name: 'GOLDEN GRAND',           kuboos: 17                },
    { name: 'SS BAKERY',              kuboos: 19                },
    { name: 'KABAB KAZANIA'                                     },
    { name: 'MEXICO THALAPDI',        kuboos: 17                },
    { name: 'PRAJITH',                             rumali: 10,  soft: 21 },
    { name: 'CHAI CLUB',              kuboos: 19                },
    { name: 'CHARCOLE THALAPADI',     kuboos: 19,   rumali: 10  },
    { name: 'SHAWRMA POINT',          kuboos: 19                },
    { name: 'KING KABAB'                                        },
    { name: 'CARBON THALAPADI'                                  },
    { name: 'ROYAL DINNER',           kuboos: 17,   rumali: 9   },
  ],
  'Mangaluru': [
    { name: 'MAANI PUTHUR'                                      },
    { name: 'HAMEED MADDIKARY'                                  },
    { name: 'KUDLA'                                             },
    { name: 'SAKEER'                                            },
    { name: 'BIGFATTROLL'                                       },
    { name: 'SMOCKEY DERLAKATTA'                                },
    { name: 'SMOCKEY MANGLURU'                                  },
    { name: 'OASIS'                                             },
    { name: 'FICKA CAFFE'                                       },
    { name: 'CATERING THEKOTTU'                                 },
    { name: 'MUNEER'                                            },
    { name: 'BUDKAL'                                            },
    { name: 'DARMASATALA'                                       },
    { name: 'KABAB DERLAKATTA'                                  },
    { name: 'ALIYAS THALAPADI',       kuboos: 17,   rumali: 9   },
    { name: 'CRAZY',                               rumali: 10  },
    { name: 'KABAB NATION THALAPADI',              rumali: 9   },
    { name: 'LAZZY CAFFE'                                       },
  ],
  'Commission': [
    { name: 'SULLIA'                                            },
    { name: 'CH KASARGODE'                                      },
    { name: 'ISMAIL COMMITION'                                  },
    { name: 'MSA DERLAKATTA'                                    },
    { name: 'DRIPDROP PUTHUR'                                   },
  ],
};

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

async function deleteCollection(colName) {
  const snap = await getDocs(collection(db, colName));
  let deleted = 0;
  // batch deletes in chunks of 500
  const chunks = [];
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    chunks.push(docs.slice(i, i + 400));
  }
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }
  console.log(`  Deleted ${deleted} docs from ${colName}`);
}

async function seed() {
  console.log('\n═══════════════════════════════════════');
  console.log(' DAILY FRESH - PRODUCTION SEED');
  console.log('═══════════════════════════════════════\n');

  // ─── STEP 1: Clear old data ───────────────
  console.log('STEP 1: Wiping old data...');
  await deleteCollection('clients');
  await deleteCollection('clientPricing');
  // Clear config/regions
  try {
    await deleteDoc(doc(db, 'config', 'regions'));
    console.log('  Deleted config/regions');
  } catch (e) {
    console.log('  config/regions not found, skipping');
  }
  // Clear trash (orphans from deleted clients)
  await deleteCollection('trash');
  console.log('  Old data wiped.\n');

  // ─── STEP 2: Write regions ────────────────
  console.log('STEP 2: Creating regions...');
  await setDoc(doc(db, 'config', 'regions'), { list: REGIONS });
  console.log(`  Created ${REGIONS.length} regions: ${REGIONS.join(', ')}\n`);

  // ─── STEP 3: Create clients + pricing ─────
  console.log('STEP 3: Creating clients and pricing...');
  const now = new Date().toISOString();
  let totalClients = 0;
  let totalPricing = 0;

  for (const regionName of REGIONS) {
    const regionClients = CLIENTS_DATA[regionName] || [];
    console.log(`\n  Region: ${regionName} (${regionClients.length} clients)`);

    for (const clientDef of regionClients) {
      const clientId = generateId('CLT');
      const clientDoc = {
        id: clientId,
        name: clientDef.name,
        region: regionName,
        regionName: regionName,
        status: 'active',
        outstanding: 0,
        totalOrders: 0,
        totalRevenue: 0,
        createdAt: now,
        updatedAt: now,
      };

      // Write client
      await setDoc(doc(db, 'clients', clientId), clientDoc);
      totalClients++;

      // Build pricing map
      const pricing = {};
      if (clientDef.kuboos !== undefined) pricing[KUBOOS_ID] = clientDef.kuboos;
      if (clientDef.rumali !== undefined) pricing[RUMALI_ID] = clientDef.rumali;
      // Note: SOFT and BUN products don't have IDs in Firestore yet — skip

      if (Object.keys(pricing).length > 0) {
        await setDoc(doc(db, 'clientPricing', clientId), {
          clientId,
          pricing,
          updatedAt: now,
        });
        totalPricing++;
        const priceStr = Object.entries(pricing).map(([k,v]) => `${k}=₹${v}`).join(', ');
        console.log(`    ✓ ${clientDef.name} [with pricing: ${priceStr}]`);
      } else {
        console.log(`    ✓ ${clientDef.name} [no pricing]`);
      }
    }
  }

  // ─── STEP 4: Verification summary ─────────
  console.log('\n═══════════════════════════════════════');
  console.log(' VERIFICATION SUMMARY');
  console.log('═══════════════════════════════════════');

  const clientsSnap = await getDocs(collection(db, 'clients'));
  const pricingSnap = await getDocs(collection(db, 'clientPricing'));

  console.log(`\n  ✅ Total Regions    : ${REGIONS.length}`);
  console.log(`  ✅ Total Clients    : ${clientsSnap.size}`);
  console.log(`  ✅ Pricing Records  : ${pricingSnap.size}`);

  // Verify region distribution
  const regionCounts = {};
  clientsSnap.forEach(d => {
    const r = d.data().region;
    regionCounts[r] = (regionCounts[r] || 0) + 1;
  });
  console.log('\n  Region distribution:');
  Object.entries(regionCounts).forEach(([r, c]) => console.log(`    ${r}: ${c} clients`));

  console.log('\n  ✅ PRODUCTION SEED COMPLETE\n');
  process.exit(0);
}

seed().catch(e => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
