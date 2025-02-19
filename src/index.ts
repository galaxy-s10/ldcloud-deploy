import { handleBuild } from './build';
import { handleAliOssCDN } from './cdn/ali-oss';
import { handleHuaweiObsCDN } from './cdn/huawei-obs';
import { handleQiniuKodoCDN } from './cdn/qiniu-kodo';
import { handleTencentOssCDN } from './cdn/tencent-cos';
import { BilldDeploy, CdnEnum, EnvEnum } from './interface';
import { handleRelease } from './release';
import { handleSSH } from './ssh';
import { calculateRemainingTime } from './utils';
import { chalkERROR, chalkSUCCESS, chalkWARN } from './utils/chalkTip';
import { deleteDeployFile, generateDeployFile } from './utils/git';
import { handlePm2Tip } from './utils/pm2Tip';

export * from './interface';

export const deploy = async function (data: BilldDeploy) {
  const startTime = new Date().getTime();
  const { env, config, verifyGit, shouldRelease } = data;
  if (!config || !env) {
    console.log(chalkERROR('缺少env或config！'));
    return;
  }

  const allowEnv = Object.keys(EnvEnum);
  if (!allowEnv.includes(env)) {
    console.log(chalkERROR(`env错误, env必须是: ${allowEnv.toString()}之一`));
    return;
  }

  const allowCdn = Object.keys(CdnEnum);
  if (!allowCdn.includes(config.cdn(data))) {
    console.log(
      chalkERROR(`config.cdn错误, config.cdn必须是: ${allowCdn.toString()}之一`)
    );
    return;
  }

  try {
    if (env === 'prod') {
      await handleRelease(verifyGit, shouldRelease);
    }
    handleBuild(data);
    generateDeployFile();
    if (config.cdn(data)) {
      console.log(chalkWARN('配置了CDN,开始执行CDN操作'));
      switch (config.cdn(data)) {
        case CdnEnum.huawei:
          await handleHuaweiObsCDN(data);
          break;
        case CdnEnum.ali:
          await handleAliOssCDN(data);
          break;
        case CdnEnum.qiniu:
          await handleQiniuKodoCDN(data);
          break;
        case CdnEnum.tencent:
          await handleTencentOssCDN(data);
          break;
      }
    }
    if (config.ssh(data)) {
      console.log(chalkWARN('配置了SSH,开始执行SSH操作'));
      await handleSSH(data);
    }
    deleteDeployFile();
    const endTime = new Date().getTime();
    handlePm2Tip(data);
    console.log(
      chalkSUCCESS(
        `构建${env}成功，总耗时：${calculateRemainingTime({
          startTime,
          endTime,
        })}`
      )
    );
  } catch (error) {
    console.log(chalkERROR(`构建${env}出错`), error);
  }
};
