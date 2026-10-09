#!/usr/bin/env python3
"""Prototype 5v5 NHL skater Corsi RAPM; does NOT power live SportsLab picks.

Install: pip install pandas numpy scipy scikit-learn
Export:  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/export_nhl_rapm.sql
Train:   python scripts/train_nhl_rapm.py --csv nhl_rapm_stints.csv \
            --season 20252026 --cutoff 2026-04-01 --out rapm.json
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error
from sklearn.model_selection import TimeSeriesSplit

REQUIRED = {'game_id','season_id','local_game_date','duration_seconds',
            'score_diff_home','zone_start','home_rest_days','away_rest_days',
            'home_shot_attempts','away_shot_attempts','home_skaters','away_skaters'}


def lineup(value):
    try:
        rows=json.loads(value) if isinstance(value,str) else value
        pairs=[(int(p['player_id']),int(p['team_id'])) for p in rows]
        if len(pairs)==5 and len(set(pairs))==5:
            return pairs
    except (ValueError,TypeError,KeyError):
        pass
    return None


def features(own,opponent,home,score,rest,zone):
    f={f'O:{player}:{team}':1. for player,team in own}
    f.update({f'D:{player}:{team}':1. for player,team in opponent})
    f['ctx:home']=float(home)
    if pd.notna(score):
        f['ctx:score_diff']=(float(score) if home else -float(score))/3.
    if pd.notna(rest):
        f['ctx:rest_diff']=float(rest)/3.
    if zone in ('offensive','defensive','neutral'):
        oriented=zone if home or zone=='neutral' else ('defensive' if zone=='offensive' else 'offensive')
        f['ctx:zone:'+oriented]=1.
    return f


def train(df,season,cutoff,min_games=24):
    missing=REQUIRED-set(df.columns)
    if missing:
        raise ValueError('Missing columns: '+', '.join(sorted(missing)))
    df=df.copy()
    df['local_game_date']=pd.to_datetime(df['local_game_date'],errors='coerce')
    df=df[(df.season_id.astype(str)==str(season))&
          (df.local_game_date<pd.Timestamp(cutoff))]
    df=df.sort_values(['local_game_date','game_id'])
    rows=[]; y=[]; w=[]; gid=[]; rejected=0
    for r in df.to_dict('records'):
        h=lineup(r['home_skaters']);a=lineup(r['away_skaters'])
        seconds=float(r['duration_seconds'])
        if not h or not a or set(h)&set(a) or not np.isfinite(seconds) or seconds<5:
            rejected+=1;continue
        if pd.isna(r['home_shot_attempts']) or pd.isna(r['away_shot_attempts']):
            rejected+=1;continue
        home_count=float(r['home_shot_attempts'])
        away_count=float(r['away_shot_attempts'])
        if min(home_count,away_count)<0:
            rejected+=1;continue
        rest=np.nan
        if pd.notna(r['home_rest_days']) and pd.notna(r['away_rest_days']):
            rest=float(r['home_rest_days'])-float(r['away_rest_days'])
        for own,against,is_home,attempts,rest_diff in (
            (h,a,True,home_count,rest),(a,h,False,away_count,-rest)):
            rows.append(features(own,against,is_home,r['score_diff_home'],rest_diff,r['zone_start']))
            y.append(attempts*3600./seconds)
            w.append(seconds)
            gid.append(str(r['game_id']))
    games=df[['game_id','local_game_date']].drop_duplicates('game_id').sort_values(['local_game_date','game_id'])
    ordered=[str(g) for g in games.game_id if str(g) in set(gid)]
    if len(set(ordered))<min_games or len(y)<50:
        raise ValueError('Insufficient valid games for reliable RAPM training')
    vec=DictVectorizer(sparse=True)
    X=vec.fit_transform(rows);y=np.asarray(y);w=np.asarray(w);gid=np.asarray(gid)
    n_splits=min(4,max(2,len(ordered)//8))
    folds=list(TimeSeriesSplit(n_splits=n_splits).split(ordered))
    alphas=[1.,10.,100.,1000.,10000.]
    scores={}
    for alpha in alphas:
        values=[]
        for train_games,test_games in folds:
            tr=np.flatnonzero(np.isin(gid,np.asarray(ordered)[train_games]))
            te=np.flatnonzero(np.isin(gid,np.asarray(ordered)[test_games]))
            if len(tr)<20 or len(te)<8:
                continue
            model=Ridge(alpha=alpha,solver='lsqr')
            model.fit(X[tr],y[tr],sample_weight=w[tr])
            values.append(float(np.sqrt(mean_squared_error(y[te],model.predict(X[te]),sample_weight=w[te]))))
        if values:
            scores[alpha]=float(np.mean(values))
    if not scores:
        raise ValueError('Not enough complete chronological folds to select ridge alpha')
    best=min(scores,key=scores.get)
    model=Ridge(alpha=best,solver='lsqr').fit(X,y,sample_weight=w)
    coefficients={}
    for col,weight in zip(vec.get_feature_names_out(),model.coef_):
        if not col.startswith(('O:','D:')):continue
        role,pid,team=col.split(':');k=(int(pid),int(team))
        item=coefficients.setdefault(k,{'player_id':int(pid),'team_id':int(team),
            'offensive_per60':0.,'defensive_against_per60':0.})
        item['offensive_per60' if role=='O' else 'defensive_against_per60']=float(weight)
    return {'season_id':int(season),'cutoff_exclusive':cutoff,'target':'5v5 Corsi For /60',
            'ridge_alpha':best,'forward_game_cv_rmse':scores,'baseline_per60':float(model.intercept_),
            'independent_games':len(set(gid)),'stints':len(y)//2,'rejected_stints':rejected,
            'player_team_coefficients':list(coefficients.values()),
            'limitations':'Not a goal/prop probability. Negative defense-against means suppressing opponents. Use only with verified event and skater attribution.'}


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--csv',type=Path,required=True);ap.add_argument('--season',type=int,required=True)
    ap.add_argument('--cutoff',type=str,required=True)
    ap.add_argument('--out',type=Path,default=Path('rapm.json'))
    args=ap.parse_args()
    data=train(pd.read_csv(args.csv),args.season,args.cutoff)
    args.out.write_text(json.dumps(data,indent=2,allow_nan=False),encoding='utf8')
    print('Wrote',len(data['player_team_coefficients']),'player-team coefficients to',args.out)


if __name__=='__main__':
    main()
