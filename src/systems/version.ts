export const VERSION = __VERSION__;
export const MILESTONE = __MILESTONE__;
export const BUILD_DATE = __BUILD_DATE__;
export const IS_DEV = __DEV__;

export function versionLabel(): string {
  return `v${VERSION} ${MILESTONE} · ${BUILD_DATE}${IS_DEV ? ' · dev' : ''}`;
}
