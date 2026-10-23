// 前 n 名，末位同分的一起上榜；同分同名次（1、2、2、4）；同分时按项目名排列，结果稳定。
export function topWithTies(items, n = 20) {
  const sorted = [...items].sort((a, b) => b.gain - a.gain || (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1));
  let cut = sorted.length;
  if (sorted.length > n) {
    const floor = sorted[n - 1].gain;
    cut = n + sorted.slice(n).filter((x) => x.gain === floor).length;
  }
  let rank = 0;
  return sorted.slice(0, cut).map((x, i) => {
    if (i === 0 || x.gain !== sorted[i - 1].gain) rank = i + 1;
    return { ...x, rank };
  });
}
