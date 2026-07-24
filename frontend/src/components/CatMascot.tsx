import { useState, useEffect } from 'react'

function CatMascot() {
  const [blink, setBlink] = useState(false)
  const [earWiggle, setEarWiggle] = useState(false)
  const [breathing, setBreathing] = useState(true)

  useEffect(() => {
    // 随机眨眼
    const blinkTimer = setInterval(() => {
      setBlink(true)
      setTimeout(() => setBlink(false), 150)
    }, 3000 + Math.random() * 4000)

    // 随机动耳朵
    const earTimer = setInterval(() => {
      setEarWiggle(true)
      setTimeout(() => setEarWiggle(false), 300)
    }, 5000 + Math.random() * 7000)

    return () => {
      clearInterval(blinkTimer)
      clearInterval(earTimer)
    }
  }, [])

  return (
    <div style={styles.container} title="我是你的配音小助手喵~">
      <div style={{
        ...styles.cat,
        transform: breathing ? 'scaleY(1.02)' : 'scaleY(1)',
        transition: 'transform 2s ease-in-out',
      }}>
        {/* 身体 */}
        <div style={styles.body}>
          {/* 头 */}
          <div style={styles.head}>
            {/* 左耳 */}
            <div style={{
              ...styles.ear,
              ...styles.leftEar,
              transform: earWiggle ? 'rotate(-15deg)' : 'rotate(-5deg)',
              transition: 'transform 0.3s ease',
            }} />
            {/* 右耳 */}
            <div style={{
              ...styles.ear,
              ...styles.rightEar,
              transform: earWiggle ? 'rotate(15deg)' : 'rotate(5deg)',
              transition: 'transform 0.3s ease',
            }} />
            {/* 脸 */}
            <div style={styles.face}>
              {/* 眼睛 */}
              <div style={styles.eyes}>
                <div style={{
                  ...styles.eye,
                  ...(blink ? styles.eyeClosed : {}),
                }} />
                <div style={{
                  ...styles.eye,
                  ...(blink ? styles.eyeClosed : {}),
                }} />
              </div>
              {/* 鼻子 */}
              <div style={styles.nose} />
              {/* 嘴 */}
              <div style={styles.mouth} />
              {/* 胡须 */}
              <div style={styles.whiskers}>
                <div style={{ ...styles.whisker, ...styles.whiskerLeft1 }} />
                <div style={{ ...styles.whisker, ...styles.whiskerLeft2 }} />
                <div style={{ ...styles.whisker, ...styles.whiskerRight1 }} />
                <div style={{ ...styles.whisker, ...styles.whiskerRight2 }} />
              </div>
            </div>
          </div>
          {/* 趴着的身体 */}
          <div style={styles.bodyOval} />
          {/* 尾巴 */}
          <div style={styles.tail} />
        </div>
      </div>
      {/* Zzz 气泡 */}
      <div style={styles.zzz}>Zzz...</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 48,
    right: 16,
    zIndex: 100,
    pointerEvents: 'none',
  },
  cat: {
    position: 'relative',
  },
  body: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  head: {
    position: 'relative',
    width: 60,
    height: 52,
    zIndex: 2,
  },
  ear: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeft: '8px solid transparent',
    borderRight: '8px solid transparent',
    borderBottom: '16px solid #F4A460',
  },
  leftEar: {
    left: 6,
    borderBottomColor: '#E8953A',
  },
  rightEar: {
    right: 6,
    borderBottomColor: '#F4A460',
  },
  face: {
    width: 60,
    height: 52,
    backgroundColor: '#F4A460',
    borderRadius: '50% 50% 45% 45%',
    position: 'relative',
    border: '2px solid #E8953A',
  },
  eyes: {
    display: 'flex',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 16,
  },
  eye: {
    width: 8,
    height: 8,
    backgroundColor: '#2C2C2C',
    borderRadius: '50%',
    transition: 'all 0.1s',
  },
  eyeClosed: {
    height: 2,
    marginTop: 3,
    borderRadius: 1,
  },
  nose: {
    width: 6,
    height: 5,
    backgroundColor: '#FF9F43',
    borderRadius: '50%',
    margin: '4px auto 0',
  },
  mouth: {
    width: 14,
    height: 6,
    borderBottom: '2px solid #C0753A',
    borderRadius: '0 0 7px 7px',
    margin: '1px auto 0',
  },
  whiskers: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  whisker: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#C0753A',
    borderRadius: 1,
  } as React.CSSProperties,
  whiskerLeft1: { top: 22, left: -12, width: 14, transform: 'rotate(-10deg)' } as React.CSSProperties,
  whiskerLeft2: { top: 25, left: -12, width: 14, transform: 'rotate(5deg)' } as React.CSSProperties,
  whiskerRight1: { top: 22, right: -12, width: 14, transform: 'rotate(10deg)' } as React.CSSProperties,
  whiskerRight2: { top: 25, right: -12, width: 14, transform: 'rotate(-5deg)' } as React.CSSProperties,
  bodyOval: {
    width: 50,
    height: 36,
    backgroundColor: '#F4A460',
    borderRadius: '50%',
    marginTop: -8,
    border: '2px solid #E8953A',
  },
  tail: {
    position: 'absolute',
    right: -20,
    bottom: 5,
    width: 24,
    height: 6,
    backgroundColor: '#F4A460',
    borderRadius: '0 10px 10px 0',
    transform: 'rotate(15deg)',
    animation: 'tailWag 4s ease-in-out infinite',
  },
  zzz: {
    position: 'absolute',
    top: -30,
    right: -8,
    fontSize: 11,
    color: '#B0A89E',
    opacity: 0.6,
    fontStyle: 'italic',
  },
}

export default CatMascot
