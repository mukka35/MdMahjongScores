const MahjongCalc = (() => {
  const SCORE_TABLE = {
    nonDealer: {
      1: {
        30: { ron: 1000, tsumo: { nonDealer: 300, dealer: 500 } },
        40: { ron: 1300, tsumo: { nonDealer: 400, dealer: 700 } },
        50: { ron: 1600, tsumo: { nonDealer: 400, dealer: 800 } },
        60: { ron: 2000, tsumo: { nonDealer: 500, dealer: 1000 } },
        70: { ron: 2300, tsumo: { nonDealer: 600, dealer: 1200 } },
        80: { ron: 2600, tsumo: { nonDealer: 700, dealer: 1300 } },
        90: { ron: 2900, tsumo: { nonDealer: 800, dealer: 1500 } },
        100: { ron: 3200, tsumo: { nonDealer: 800, dealer: 1600 } },
        110: { ron: 3600, tsumo: { nonDealer: 900, dealer: 1800 } }
      },
      2: {
        20: { ron: null, tsumo: { nonDealer: 400, dealer: 700 } },
        25: { ron: 1600, tsumo: { nonDealer: 400, dealer: 800 } },
        30: { ron: 2000, tsumo: { nonDealer: 500, dealer: 1000 } },
        40: { ron: 2600, tsumo: { nonDealer: 700, dealer: 1300 } },
        50: { ron: 3200, tsumo: { nonDealer: 800, dealer: 1600 } },
        60: { ron: 3900, tsumo: { nonDealer: 1000, dealer: 2000 } },
        70: { ron: 4500, tsumo: { nonDealer: 1200, dealer: 2300 } },
        80: { ron: 5200, tsumo: { nonDealer: 1300, dealer: 2600 } },
        90: { ron: 5800, tsumo: { nonDealer: 1500, dealer: 2900 } },
        100: { ron: 6400, tsumo: { nonDealer: 1600, dealer: 3200 } },
        110: { ron: 7100, tsumo: { nonDealer: 1800, dealer: 3600 } }
      },
      3: {
        20: { ron: null, tsumo: { nonDealer: 700, dealer: 1300 } },
        25: { ron: 3200, tsumo: { nonDealer: 800, dealer: 1600 } },
        30: { ron: 3900, tsumo: { nonDealer: 1000, dealer: 2000 } },
        40: { ron: 5200, tsumo: { nonDealer: 1300, dealer: 2600 } },
        50: { ron: 6400, tsumo: { nonDealer: 1600, dealer: 3200 } },
        60: { ron: 8000, tsumo: { nonDealer: 2000, dealer: 4000 } }
      },
      4: {
        20: { ron: null, tsumo: { nonDealer: 1300, dealer: 2600 } },
        25: { ron: 6400, tsumo: { nonDealer: 1600, dealer: 3200 } }
      }
    },
    dealer: {
      1: {
        30: { ron: 1500, tsumo: { all: 500 } },
        40: { ron: 2000, tsumo: { all: 700 } },
        50: { ron: 2400, tsumo: { all: 800 } },
        60: { ron: 2900, tsumo: { all: 1000 } },
        70: { ron: 3400, tsumo: { all: 1200 } },
        80: { ron: 3900, tsumo: { all: 1300 } },
        90: { ron: 4400, tsumo: { all: 1500 } },
        100: { ron: 4800, tsumo: { all: 1600 } },
        110: { ron: 5300, tsumo: { all: 1800 } }
      },
      2: {
        20: { ron: null, tsumo: { all: 700 } },
        25: { ron: 2400, tsumo: { all: 800 } },
        30: { ron: 2900, tsumo: { all: 1000 } },
        40: { ron: 3900, tsumo: { all: 1300 } },
        50: { ron: 4800, tsumo: { all: 1600 } },
        60: { ron: 5800, tsumo: { all: 2000 } },
        70: { ron: 6800, tsumo: { all: 2300 } },
        80: { ron: 7700, tsumo: { all: 2600 } },
        90: { ron: 8700, tsumo: { all: 2900 } },
        100: { ron: 9600, tsumo: { all: 3200 } },
        110: { ron: 10600, tsumo: { all: 3600 } }
      },
      3: {
        20: { ron: null, tsumo: { all: 1300 } },
        25: { ron: 4800, tsumo: { all: 1600 } },
        30: { ron: 5800, tsumo: { all: 2000 } },
        40: { ron: 7700, tsumo: { all: 2600 } },
        50: { ron: 9600, tsumo: { all: 3200 } },
        60: { ron: 12000, tsumo: { all: 4000 } }
      },
      4: {
        20: { ron: null, tsumo: { all: 2600 } },
        25: { ron: 9600, tsumo: { all: 3200 } }
      }
    }
  };

  const LIMIT_HAND_TABLE = {
    5: {
      dealer: { ron: 12000, tsumo: { all: 4000 } },
      nonDealer: { ron: 8000, tsumo: { dealer: 4000, nonDealer: 2000 } }
    },
    6: {
      dealer: { ron: 18000, tsumo: { all: 6000 } },
      nonDealer: { ron: 12000, tsumo: { dealer: 6000, nonDealer: 3000 } }
    },
    8: {
      dealer: { ron: 24000, tsumo: { all: 8000 } },
      nonDealer: { ron: 16000, tsumo: { dealer: 8000, nonDealer: 4000 } }
    },
    13: {
      dealer: { ron: 48000, tsumo: { all: 16000 } },
      nonDealer: { ron: 32000, tsumo: { dealer: 16000, nonDealer: 8000 } }
    }
  };

  function getSeatKey(isDealer) {
    return isDealer ? 'dealer' : 'nonDealer';
  }

  function normalizeLimitHan(han) {
    if (han >= 13) return 13;
    if (han >= 8) return 8;
    if (han >= 6) return 6;
    if (han >= 5) return 5;
    return han;
  }

  function getTableEntry(han, fu, isDealer) {
    const seatKey = getSeatKey(isDealer);
    return SCORE_TABLE[seatKey]?.[han]?.[fu] || null;
  }

  function getAvailableFuOptions({ han, type, isDealer }) {
    if (han >= 5) return [];

    const seatKey = getSeatKey(isDealer);
    const entries = SCORE_TABLE[seatKey]?.[han] || {};
    return Object.keys(entries)
      .map(Number)
      .filter(fu => {
        const entry = entries[fu];
        return type === 'ron' ? entry.ron !== null : !!entry.tsumo;
      })
      .sort((left, right) => left - right);
  }

  function getLimitEntry(han, isDealer) {
    const seatKey = getSeatKey(isDealer);
    return LIMIT_HAND_TABLE[normalizeLimitHan(han)]?.[seatKey] || null;
  }

  function getAgariScore({ han, fu, type, isDealer, honba = 0, playerCount = 4 }) {
    const honbaBonusPerPayer = honba * 100;

    if (han >= 5) {
      const limitEntry = getLimitEntry(han, isDealer);
      if (!limitEntry) return null;

      if (type === 'ron') {
        return { type: 'ron', ron: limitEntry.ron + (honba * 300) };
      }

      if (isDealer) {
        const allPay = limitEntry.tsumo.all + honbaBonusPerPayer;
        return { type: 'tsumo', dealerPay: 0, nonDealerPay: allPay, total: allPay * (playerCount - 1) };
      }

      const dealerPay = limitEntry.tsumo.dealer + honbaBonusPerPayer;
      const nonDealerPay = limitEntry.tsumo.nonDealer + honbaBonusPerPayer;
      return {
        type: 'tsumo',
        dealerPay,
        nonDealerPay,
        total: dealerPay + (nonDealerPay * (playerCount - 2))
      };
    }

    const entry = getTableEntry(han, fu, isDealer);
    if (!entry) return null;

    if (type === 'ron') {
      if (entry.ron === null) return null;
      return { type: 'ron', ron: entry.ron + (honba * 300) };
    }

    if (isDealer) {
      const allPay = entry.tsumo.all + honbaBonusPerPayer;
      return { type: 'tsumo', dealerPay: 0, nonDealerPay: allPay, total: allPay * (playerCount - 1) };
    }

    const dealerPay = entry.tsumo.dealer + honbaBonusPerPayer;
    const nonDealerPay = entry.tsumo.nonDealer + honbaBonusPerPayer;
    return {
      type: 'tsumo',
      dealerPay,
      nonDealerPay,
      total: dealerPay + (nonDealerPay * (playerCount - 2))
    };
  }

  return {
    getAvailableFuOptions,
    getAgariScore
  };
})();
