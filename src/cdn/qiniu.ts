import fs from 'fs';
import path from 'path';

import qiniu from 'qiniu';

import { BilldDeploy } from '../interface';
import {
  chalkERROR,
  chalkINFO,
  chalkSUCCESS,
  chalkWARN,
} from '../utils/chalkTip';
import Queue from '../utils/queue';

export const handleQiniuCDN = function (data: BilldDeploy) {
  const { qiniuConfig: cdnConfig, qiniuFileConfig: cdnFileConfig } =
    data.config;
  if (!cdnConfig || !cdnFileConfig) return;

  const qiniuConfig = cdnConfig(data);
  const qiniuFileConfig = cdnFileConfig(data);

  // https://developer.qiniu.com/kodo/1289/nodejs
  const mac = new qiniu.auth.digest.Mac(
    qiniuConfig.accessKey,
    qiniuConfig.secretKey
  );
  const qiniuConfConfig = new qiniu.conf.Config();
  // @ts-ignore
  qiniuConfConfig.zone = qiniuConfig.zone;

  function findFile(inputDir) {
    const res: string[] = [];
    function loop(dirArr) {
      for (let i = 0; i < dirArr.length; i += 1) {
        const file = dirArr[i];
        const filePath = path.resolve(inputDir, file);
        const stat = fs.statSync(filePath);
        const isDir = stat.isDirectory();
        if (!isDir) {
          res.push(filePath);
        } else {
          loop(fs.readdirSync(filePath).map((key) => path.join(file, key)));
        }
      }
    }

    let inputDirArr: string[] = [];

    try {
      inputDirArr = fs.readdirSync(inputDir);
    } catch (error) {
      // eslint-disable-next-line
      console.log(chalkERROR(`${inputDir},路径不存在！`));
      // eslint-disable-next-line
      throw new Error(`${inputDir},路径不存在！`);
    }

    loop(inputDirArr);

    return res;
  }
  try {
    const uploadOkRecord = new Map(); // 上传成功记录
    const uploadErrRecord = new Map(); // 上传失败记录
    const allFile: string[] = []; // 所有需要上传的文件

    if (qiniuFileConfig.dir) {
      // 添加qiniuFileConfig目录
      allFile.push(...findFile(qiniuFileConfig.dir.local));
    } else {
      console.log(chalkWARN('没有配置上传本地目录到qiniu目录'));
    }

    if (qiniuFileConfig.file) {
      qiniuFileConfig.file.local.forEach((item) => {
        // 添加qiniuFileConfig的文件
        allFile.push(item);
      });
    } else {
      console.log(chalkWARN('没有配置上传本地文件到qiniu目录'));
    }

    // eslint-disable-next-line
    async function put(key, filePath) {
      try {
        const formUploader = new qiniu.form_up.FormUploader(qiniuConfConfig);
        const options = {
          // eslint-disable-next-line
          scope: `${qiniuConfig.bucket}:${key}`,
        };
        const putPolicy = new qiniu.rs.PutPolicy(options);
        const uploadToken = putPolicy.uploadToken(mac);
        const putExtra = new qiniu.form_up.PutExtra();
        const result = await new Promise<{
          code: number;
          respErr?;
          respBody?;
          respInfo?;
        }>((resolve) => {
          formUploader.putFile(
            uploadToken,
            key,
            filePath,
            putExtra,
            function (respErr, respBody, respInfo) {
              if (respErr) {
                return resolve({ code: 500, respErr, respBody, respInfo });
              }
              if (respInfo.statusCode == 200) {
                return resolve({ code: 200 });
              } else {
                return resolve({ code: 500, respErr, respBody, respInfo });
              }
            }
          );
        });
        // const result = { code: 200 }
        const status = result.code;
        if (status === 200) {
          uploadOkRecord.set(filePath, status);
          console.log(
            chalkSUCCESS(
              `上传qiniu成功(${
                uploadOkRecord.size
                // eslint-disable-next-line
              }/${allFile.length}): ${filePath} ===> ${key}`
            )
          );
        } else {
          uploadErrRecord.set(filePath, status);
          console.log(result);
          console.log(
            chalkERROR(
              // eslint-disable-next-line
              `上传qiniu失败(${uploadErrRecord.size}/${allFile.length}): ${filePath} ===> ${key}`
            )
          );
        }
        const progress = uploadOkRecord.size + uploadErrRecord.size;
        if (progress === allFile.length) {
          console.log(
            chalkINFO(
              `所有文件上传qiniu完成。成功：${uploadOkRecord.size}/${allFile.length}；失败：${uploadErrRecord.size}/${allFile.length}`
            )
          );

          if (uploadErrRecord.size) {
            console.log(chalkERROR(`上传qiniu失败数据`), uploadErrRecord);
          }
        }
      } catch (error) {
        console.log(chalkERROR(`上传qiniu错误`), error);
      }
    }

    return new Promise((resolve) => {
      // 这里需要限制并发数
      const uploadQueue = new Queue({
        max: 5,
        done: () => resolve('all done~'),
      });
      allFile.forEach((filePath) => {
        if (qiniuFileConfig.file) {
          if (qiniuFileConfig.file.local.includes(filePath)) {
            const filename = filePath.split(path.sep).pop() || '';
            const key = path.join(qiniuConfig.prefix, filename);
            uploadQueue.addTask(() =>
              put(path.sep === '/' ? key : key.replace(/\\/g, '/'), filePath)
            );
          } else {
            if (qiniuFileConfig.dir) {
              const dirName =
                qiniuFileConfig.dir.local.split(path.sep).pop() || '';
              const ignoreDir = qiniuFileConfig.dir.ignoreDir;
              const key =
                qiniuConfig.prefix +
                filePath.replace(
                  qiniuFileConfig.dir.local,
                  ignoreDir ? '' : path.sep + dirName
                );
              uploadQueue.addTask(() =>
                put(path.sep === '/' ? key : key.replace(/\\/g, '/'), filePath)
              );
            }
          }
        }
      });
    });
  } catch (error) {
    console.log(chalkERROR(`cdn脚本错误`), error);
  }
};
