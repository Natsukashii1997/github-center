// 前 20 名，末位同分的一起上榜；同分同名次（1、2、2、4）；同分时按项目名排列，结果稳定。
const TOP = 20;

export function topWithTies(items) {
  const sorted = [...items].sort((a, b) => b.gain - a.gain || (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1));
  let cut = sorted.length;
  if (sorted.length > TOP) {
    const floor = sorted[TOP - 1].gain;
    cut = TOP + sorted.slice(TOP).filter((x) => x.gain === floor).length;
  }
  let rank = 0;
  return sorted.slice(0, cut).map((x, i) => {
    if (i === 0 || x.gain !== sorted[i - 1].gain) rank = i + 1;
    return { ...x, rank };
  });
}
