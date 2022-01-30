/*
PoC使用说明:

1. 去阿里云OSS或者其他S3对象存储提供商，创建一个对象存储bucket（读写权限设置为 私有；可以开通版本控制和生命周期管理功能，以获得历史版本的功能，并且自动在若干天后删除历史版本）
2. 设置bucket授权，以阿里云为例，需要创建一个RAM子账号，在Bucket授权策略中给这个RAM子账号授予读写权限。记录下RAM子账号的AccessKey ID和AccessKey Secret
3. 编译此fork并在Chrome里Load unpacked。 插件 Details → Inspect Views → Background，运行

localStorage["s3BackupSpec"] = JSON.stringify({
  "endpoint": "https://oss-cn-beijing.aliyuncs.com",
  "bucket": "your-bucket-name",
  "access_key_id": "RAM子账号的AccessKey ID",
  "secret_access_key": "RAM子账号的AccessKey Secret",
  "password": "可选的密码，如果不填写，会使用默认加密密码（不太安全）"
})

4. 完成，目前的行为是：每次启动浏览器时会加载备份、每隔6小时会加载备份、每次写配置时会上传备份


 */

const S3BackupSpecKey = "s3BackupSpec"
const S3BackupFileKey = "switchsharpconfig.bak"
const defaultEncryptionPassword = "9J!2Zq&q&2L5jw%6hVHk3]K$S5JS]4yt";

class S3Backup {
    omegaInstance;
    omegaState;
    s3BackupSpec;
    s3Client;

    optimisticLockCounter = 0;

    constructor({OmegaTargetCurrent, storage, state, options}) {
        this.omegaInstance = OmegaTargetCurrent;
        this.omegaState = state;
        this.omegaOptions = options;
        this.omegaStorage = storage;
    }

    init() {
        window.triggerS3BackupSoon = () => {
            console.warn("S3 backup not configured");
        };

        const s3BackupSpec = localStorage[S3BackupSpecKey];
        if (!s3BackupSpec) {
            console.log("no s3BackupSpec is found, this feature will not be enabled")
            return
        }
        try {
            this.s3BackupSpec = JSON.parse(s3BackupSpec);
        } catch (ex) {
            console.log("invalid s3 backup spec", s3BackupSpec, " as ", ex, ", this feature will not be enabled")
            return
        }

        this.s3Client = new AWS.S3({endpoint: this.s3BackupSpec.endpoint});
        this.s3Client.config.credentials = new AWS.Credentials();
        this.s3Client.config.credentials.accessKeyId = this.s3BackupSpec.access_key_id;
        this.s3Client.config.credentials.secretAccessKey = this.s3BackupSpec.secret_access_key;

        this.tryLoadBackupFromS3();
        setInterval(() => { // try to do a load every 6 hours
            this.tryLoadBackupFromS3()
        }, 6 * 3600 * 1000);

        window.triggerS3BackupSoon = () => {
            setTimeout(() => { // add some delay to make sure config has been patched
                this.saveBackupToS3();
            }, 2000);
        };
    }

    tryLoadBackupFromS3() {
        this.optimisticLockCounter++;
        const localOptimisticLockCounter = this.optimisticLockCounter;
        this.s3Client.getObject({
            Bucket: this.s3BackupSpec.bucket, Key: S3BackupFileKey,
        }, (err, data) => {
            if (err) {
                console.warn("tryLoadBackupFromS3 failed as ", err);
                return;
            }
            if (localOptimisticLockCounter !== this.optimisticLockCounter) {
                console.warn("tryLoadBackupFromS3: optimistic lock failed");
                return;
            }

            arrayBufferToString(data.Body, _fullConfigFromBackup => {
                let fullConfigFromBackup = "";
                try {
                    fullConfigFromBackup = CryptoJS.AES.decrypt(_fullConfigFromBackup, this.getEncryptionKey()).toString(CryptoJS.enc.Utf8)
                } catch (ex) {
                    console.warn("tryLoadBackupFromS3: failed to decrypt backup, wrong password?", ex);
                    return;
                }
                this.omegaStorage.get(null).then(_currentFullConfig => {
                    const currentFullConfig = JSON.stringify(_currentFullConfig);
                    if (fullConfigFromBackup === currentFullConfig) {
                        console.warn("tryLoadBackupFromS3: config from backup is identical with current config");
                        return;
                    }

                    const originalProfileName = this.omegaOptions._currentProfileName;
                    this.omegaOptions.reset(JSON.parse(fullConfigFromBackup))
                    setTimeout(() => {
                        this.omegaOptions.applyProfile(originalProfileName);
                    }, 3500)
                })
            });
        })
    }

    getEncryptionKey() {
        return this.s3BackupSpec.password || defaultEncryptionPassword;
    }

    saveBackupToS3() {
        this.optimisticLockCounter++;
        this.omegaStorage.get(null).then(fullConfig => {
            this.optimisticLockCounter++;
            console.log("saveBackupToS3", fullConfig)
            this.s3Client.putObject({
                Body: CryptoJS.AES.encrypt(JSON.stringify(fullConfig), this.getEncryptionKey()).toString(),
                Bucket: this.s3BackupSpec.bucket,
                Key: S3BackupFileKey
            }, () => {
                this.optimisticLockCounter++;
            });
        })
    }
}

module.exports = {
    init: ({OmegaTargetCurrent, storage, state, options}) => {
        new S3Backup({OmegaTargetCurrent, storage, state, options}).init();
    },
}

function arrayBufferToString(buf, callback) {
    let bb = new Blob([buf]);
    let f = new FileReader();
    f.onload = function (e) {
        callback(e.target.result);
    };
    f.readAsText(bb);
}
