export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function sem(values: number[]): number | null {
  const sd = sampleSd(values);
  return sd === null ? null : sd / Math.sqrt(values.length);
}

export function cvPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values);
  const sd = sampleSd(values);
  return sd === null || center === 0 ? null : Math.abs(sd / center) * 100;
}

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  let x = 0.9999999999998099;
  const shifted = value - 1;
  for (let index = 0; index < coefficients.length; index += 1) x += coefficients[index] / (shifted + index + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-12;
  const fpmin = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const betaTerm = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (betaTerm * betaContinuedFraction(a, b, x)) / a;
  return 1 - (betaTerm * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function studentTCdf(t: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(degreesOfFreedom) || degreesOfFreedom <= 0) return Number.NaN;
  const x = degreesOfFreedom / (degreesOfFreedom + t ** 2);
  const ibeta = regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5);
  return t >= 0 ? 1 - ibeta / 2 : ibeta / 2;
}

export function welchTTest(valuesA: number[], valuesB: number[]): { statistic: number; degreesOfFreedom: number; pValue: number } | null {
  if (valuesA.length < 2 || valuesB.length < 2) return null;
  const meanA = mean(valuesA);
  const meanB = mean(valuesB);
  const sdA = sampleSd(valuesA);
  const sdB = sampleSd(valuesB);
  if (sdA === null || sdB === null) return null;
  const varianceTermA = sdA ** 2 / valuesA.length;
  const varianceTermB = sdB ** 2 / valuesB.length;
  const denominator = Math.sqrt(varianceTermA + varianceTermB);
  if (denominator === 0) return null;
  const statistic = (meanA - meanB) / denominator;
  const degreesOfFreedom = ((varianceTermA + varianceTermB) ** 2)
    / ((varianceTermA ** 2) / (valuesA.length - 1) + (varianceTermB ** 2) / (valuesB.length - 1));
  const pValue = 2 * (1 - studentTCdf(Math.abs(statistic), degreesOfFreedom));
  return { statistic, degreesOfFreedom, pValue };
}

export function pairedTTest(valuesA: number[], valuesB: number[]): { statistic: number; degreesOfFreedom: number; pValue: number } | null {
  if (valuesA.length !== valuesB.length || valuesA.length < 2) return null;
  const differences = valuesA.map((value, index) => value - valuesB[index]);
  const center = mean(differences);
  const sd = sampleSd(differences);
  if (sd === null || sd === 0) return null;
  const statistic = center / (sd / Math.sqrt(differences.length));
  const degreesOfFreedom = differences.length - 1;
  const pValue = 2 * (1 - studentTCdf(Math.abs(statistic), degreesOfFreedom));
  return { statistic, degreesOfFreedom, pValue };
}

export function benjaminiHochberg(pValues: number[]): number[] {
  const indexed = pValues.map((pValue, index) => ({ pValue, index })).sort((a, b) => a.pValue - b.pValue);
  const adjusted = Array.from({ length: pValues.length }, () => 1);
  let runningMinimum = 1;
  for (let rank = indexed.length; rank >= 1; rank -= 1) {
    const item = indexed[rank - 1];
    runningMinimum = Math.min(runningMinimum, (item.pValue * indexed.length) / rank);
    adjusted[item.index] = Math.min(1, runningMinimum);
  }
  return adjusted;
}
